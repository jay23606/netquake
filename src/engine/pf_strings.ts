// FTE_STRINGS builtins (#221-230). Ported from QSS-M Quake/pr_ext.c PF_str*/PF_info*.
// Kept out of pf.ts to keep that file readable; strpad (#225) already lived in pf.ts
// before this extension was scoped, so it isn't duplicated here.
import * as pr from './pr'
import * as con from './console'

const PARM0 = 4
const PARM1 = 7
const PARM2 = 10
const PARM3 = 13
const RETURN = 1

const varString = function(first: number) {
	let out = ''
	for (let i = first; i < pr.state.argc; ++i)
		out += pr.getString(pr.state.globals_int[PARM0 + i * 3])
	return out
}

// float(string s1, string sub, optional float startidx) strstrofs = #221
export const strstrofs = function() {
	const instr = pr.getString(pr.state.globals_int[PARM0])
	const match = pr.getString(pr.state.globals_int[PARM1])
	const firstofs = pr.state.argc > 2 ? (pr.state.globals_float[PARM2] | 0) : 0
	if (firstofs && (firstofs < 0 || firstofs > instr.length)) {
		pr.state.globals_float[RETURN] = -1
		return
	}
	pr.state.globals_float[RETURN] = instr.indexOf(match, firstofs)
}

// float(string str, float index) str2chr = #222
export const str2chr = function() {
	const str = pr.getString(pr.state.globals_int[PARM0])
	let ofs = pr.state.argc > 1 ? (pr.state.globals_float[PARM1] | 0) : 0
	if (ofs < 0)
		ofs = str.length + ofs
	if (ofs !== 0 && (ofs < 0 || ofs > str.length))
		pr.state.globals_float[RETURN] = 0
	else
		pr.state.globals_float[RETURN] = ofs < str.length ? str.charCodeAt(ofs) : 0
}

// string(float chr, ...) chr2str = #223
export const chr2str = function() {
	let out = ''
	for (let i = 0; i < pr.state.argc; ++i) {
		const u = Math.trunc(pr.state.globals_float[PARM0 + i * 3])
		out += ((u >= 0xe000 && u < 0xe100) || u < 256) ? String.fromCharCode(u & 0xff) : '?'
	}
	pr.state.globals_int[RETURN] = pr.newString(out, out.length + 1)
}

// part of strconv: digit glyph <-> colour variant remap
const chrconvNumber = (c: number, base: number, conv: number) => {
	const i = c - base
	switch (conv) {
		case 1: base = 0x30; break
		case 2: base = 0x30 + 128; break
		case 3: base = 0x30 - 30; break
		case 4: base = 0x30 + 128 - 30; break
	}
	return i + base
}

// part of strconv: punctuation colour remap
const chrconvPunct = (c: number, base: number, conv: number) => {
	const i = c - base
	switch (conv) {
		case 1: base = 0; break
		case 2: base = 128; break
	}
	return i + base
}

// part of strconv: letter case + colour remap
const chrconvAlpha = (c: number, basec: number, baset: number, convc: number, convt: number, charnum: number) => {
	let i = c - baset - basec
	switch (convt) {
		case 1: baset = 0; break
		case 2: baset = 128; break
		case 5:
		case 6: baset = ((charnum & 1) === (convt - 5)) ? 128 : 0; break
	}
	switch (convc) {
		case 1: basec = 0x61; break // 'a'
		case 2: basec = 0x41; break // 'A'
	}
	return i + basec + baset
}

// string(float ccase, float redalpha, float rednum, string...) strconv = #224
export const strconv = function() {
	const ccase = pr.state.globals_float[PARM0] | 0
	const redalpha = pr.state.globals_float[PARM1] | 0
	const rednum = pr.state.globals_float[PARM2] | 0
	const str = varString(3)
	let out = ''
	for (let i = 0; i < str.length; ++i) {
		const c = str.charCodeAt(i)
		let r: number
		if (c >= 0x30 && c <= 0x39) r = chrconvNumber(c, 0x30, rednum)
		else if (c >= 0x30 + 128 && c <= 0x39 + 128) r = chrconvNumber(c, 0x30 + 128, rednum)
		else if (c >= 0x30 + 128 - 30 && c <= 0x39 + 128 - 30) r = chrconvNumber(c, 0x30 + 128 - 30, rednum)
		else if (c >= 0x30 - 30 && c <= 0x39 - 30) r = chrconvNumber(c, 0x30 - 30, rednum)
		else if (c >= 0x61 && c <= 0x7a) r = chrconvAlpha(c, 0x61, 0, ccase, redalpha, i)
		else if (c >= 0x41 && c <= 0x5a) r = chrconvAlpha(c, 0x41, 0, ccase, redalpha, i)
		else if (c >= 0x61 + 128 && c <= 0x7a + 128) r = chrconvAlpha(c, 0x61, 128, ccase, redalpha, i)
		else if (c >= 0x41 + 128 && c <= 0x5a + 128) r = chrconvAlpha(c, 0x41, 128, ccase, redalpha, i)
		else if ((c & 127) < 16 || !redalpha) r = c
		else if (c < 128) r = chrconvPunct(c, 0, redalpha)
		else r = chrconvPunct(c, 128, redalpha)
		out += String.fromCharCode(r & 0xff)
	}
	pr.state.globals_int[RETURN] = pr.newString(out, out.length + 1)
}

// string(infostring old, string key, string value) infoadd = #226
export const infoadd = function() {
	const info = pr.getString(pr.state.globals_int[PARM0])
	const key = pr.getString(pr.state.globals_int[PARM1])
	const value = varString(2)

	if (!key) {
		pr.state.globals_int[RETURN] = pr.state.globals_int[PARM0]
		return
	}

	let out = ''
	let i = 0
	let malformed = false
	while (i < info.length) {
		if (info[i] !== '\\') { malformed = true; break }
		const segStart = i
		++i
		if (info.startsWith(key, i) && info[i + key.length] === '\\') {
			// drop the old value for this key
			i += key.length + 1
			while (i < info.length && info[i] !== '\\')
				++i
		} else {
			while (i < info.length && info[i] !== '\\')
				++i
			if (info[i] !== '\\') { malformed = true; break }
			++i
			while (i < info.length && info[i] !== '\\')
				++i
			out += info.substring(segStart, i)
		}
	}

	if (malformed)
		con.dPrint('PF_infoadd: invalid source info\n')
	else if (value) {
		if (key.includes('\\') || value.includes('\\'))
			con.dPrint('PF_infoadd: invalid key/value\n')
		else
			out += '\\' + key + '\\' + value
	}

	pr.state.globals_int[RETURN] = pr.newString(out, out.length + 1)
}

// string(infostring info, string key) infoget = #227
export const infoget = function() {
	const info = pr.getString(pr.state.globals_int[PARM0])
	const key = pr.getString(pr.state.globals_int[PARM1])
	let i = 0
	while (i < info.length) {
		if (info[i] !== '\\')
			break
		++i
		if (info.startsWith(key, i) && info[i + key.length] === '\\') {
			const start = i + key.length + 1
			let end = start
			while (end < info.length && info[end] !== '\\')
				++end
			pr.state.globals_int[RETURN] = pr.newString(info.substring(start, end), end - start + 1)
			return
		}
		while (i < info.length && info[i] !== '\\')
			++i
		if (info[i] !== '\\')
			break
		++i
		while (i < info.length && info[i] !== '\\')
			++i
	}
	pr.state.globals_int[RETURN] = 0
}

// #define strcmp strncmp
// float(string s1, string s2, optional float len, optional float s1ofs, optional float s2ofs) strncmp = #228
// NB: s2ofs (PARM4) is computed but unused, matching PF_strncmp in pr_ext.c exactly.
export const strncmp = function() {
	const a = pr.getString(pr.state.globals_int[PARM0])
	const b = pr.getString(pr.state.globals_int[PARM1])
	if (pr.state.argc > 2) {
		const len = pr.state.globals_float[PARM2] | 0
		let aofs = pr.state.argc > 3 ? (pr.state.globals_float[PARM3] | 0) : 0
		if (aofs < 0 || (aofs && aofs > a.length))
			aofs = a.length
		let n = len
		let i = 0
		let result = 0
		while (true) {
			if (n-- <= 0) { result = 0; break }
			const ca = i < a.length - aofs ? a.charCodeAt(aofs + i) : 0
			const cb = i < b.length ? b.charCodeAt(i) : 0
			if (ca !== cb) { result = -1; break }
			if (ca === 0) { result = 0; break }
			++i
		}
		pr.state.globals_float[RETURN] = result
	} else {
		pr.state.globals_float[RETURN] = a === b ? 0 : -1
	}
}

const qTolower = (c: number) => (c >= 0x41 && c <= 0x5a) ? c + 32 : c

const strCaseCmp = (a: string, b: string) => {
	let i = 0, c1 = 0, c2 = 0
	do {
		c1 = qTolower(i < a.length ? a.charCodeAt(i) : 0)
		c2 = qTolower(i < b.length ? b.charCodeAt(i) : 0)
		++i
		if (c1 === 0) break
	} while (c1 === c2)
	return c1 - c2
}

const strNCaseCmp = (a: string, b: string, n: number) => {
	if (n <= 0) return 0
	let i = 0, c1 = 0, c2 = 0
	do {
		c1 = qTolower(i < a.length ? a.charCodeAt(i) : 0)
		c2 = qTolower(i < b.length ? b.charCodeAt(i) : 0)
		++i
		if (c1 === 0 || c1 !== c2) break
	} while (--n > 0)
	return c1 - c2
}

// float(string s1, string s2) strcasecmp = #229
// float(string s1, string s2, float len, optional float s1ofs, optional float s2ofs) strncasecmp = #230
// Same underlying builtin in pr_ext.c (PF_strncasecmp handles both call shapes via argc);
// s2ofs (PARM4) is computed but unused there too, ported faithfully.
export const strncasecmp = function() {
	const a = pr.getString(pr.state.globals_int[PARM0])
	const b = pr.getString(pr.state.globals_int[PARM1])
	if (pr.state.argc > 2) {
		const len = pr.state.globals_float[PARM2] | 0
		let aofs = pr.state.argc > 3 ? (pr.state.globals_float[PARM3] | 0) : 0
		if (aofs < 0 || (aofs && aofs > a.length))
			aofs = a.length
		pr.state.globals_float[RETURN] = strNCaseCmp(a.substring(aofs), b, len)
	} else {
		pr.state.globals_float[RETURN] = strCaseCmp(a, b)
	}
}
