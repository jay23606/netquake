// 2021 rerelease (Kex) localization table: resolves the "$qc_*" keys the rerelease progs hand to
// the print builtins. Port of QSS-M common.c:6012-6376. State lives here rather than in HostState
// so a host.init reset cannot wipe a loaded table.

import * as com from './com'
import * as con from './console'
import * as cvar from './cvar'

export type LocState = {
  // Key (without the leading '$') -> localized value. Empty when no file is loaded.
  entries: Map<string, string>,
  // parseArg out-param, hoisted to avoid a result object per placeholder.
  argScratch: Int32Array
}

export const state: LocState = {
  entries: new Map<string, string>(),
  argScratch: new Int32Array(1)
}

export const cvr: cvar.CVars = {
}

// PR_VarString_qex's static char out[1024], including terminator.
const MAX_FORMAT = 1024

// Locale -> the rerelease's own file naming (FTE PO_Merge_Rerelease, translate.c:556-570).
const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'french',
  de: 'german',
  it: 'italian',
  ru: 'russian',
  es: 'spanish'
}

// ASCII stand-ins for the typographic punctuation NFKD leaves behind.
const PUNCTUATION: Record<string, string> = {
  '‘': '\'', '’': '\'', '‚': '\'', '‛': '\'',
  '“': '"', '”': '"', '„': '"',
  '–': '-', '—': '-', '―': '-', '−': '-',
  '‹': '<', '›': '>', '«': '"', '»': '"',
  '…': '...', ' ': ' ', '·': '.', '×': 'x', '÷': '/'
}

const isBlank = (c: string) => c === ' ' || c === '\t'

const isSpace = (c: string) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v'

// The rerelease files are UTF-8, but our text path is the 8-bit Quake charset end to end
// (msg.writeString truncates to a byte, conchars index the same) and we have no scr_usekfont.
// Anything unmappable becomes '?' rather than a run of garbage glyphs.
const foldToCharset = function(text: string)
{
  if (!/[^\u0000-\u007f]/.test(text))
    return text
  var out = '', i
  const norm = text.normalize('NFKD')
  for (i = 0; i < norm.length; ++i)
  {
    const c = norm.charCodeAt(i)
    if (c < 0x80)
    {
      out += norm[i]
      continue
    }
    if (c >= 0x0300 && c <= 0x036f) // combining marks left by the decomposition
      continue
    const sub = PUNCTUATION[norm[i]]
    out += sub !== undefined ? sub : '?'
  }
  return out
}

// QSS-M LOC_LoadFile's line parser. Duplicate keys keep the first one seen, matching what its
// open-addressed linear probe resolves to.
const parseFile = function(text: string)
{
  const entries = state.entries
  const len = text.length
  var cursor = 0, lineno = 0
  while (cursor < len)
  {
    ++lineno

    while (cursor < len && isBlank(text[cursor]))
      ++cursor

    const lineStart = cursor
    var equals = -1
    while (cursor < len && text[cursor] !== '\n')
    {
      if (text[cursor] === '=' && equals < 0)
        equals = cursor
      ++cursor
    }

    // Deviation from QSS-M, which only drops the '\r' of a CRLF file via the closing quote and
    // so leaves it in an unquoted value.
    var lineEnd = cursor
    if (lineEnd > lineStart && text[lineEnd - 1] === '\r')
      --lineEnd

    if (text[lineStart] === '/')
    {
      if (text[lineStart + 1] !== '/')
        con.dPrint('LOC_LoadFile: malformed comment on line ' + lineno + '\n')
    }
    else if (equals >= 0)
    {
      var keyEnd = equals
      while (keyEnd !== lineStart && isSpace(text[keyEnd - 1]))
        --keyEnd
      const key = text.substring(lineStart, keyEnd)

      var src = equals + 1
      while (src !== lineEnd && isSpace(text[src]))
        ++src
      if (text[src] === '"')
        ++src

      var value = '', trailingQuote = false
      while (src < lineEnd)
      {
        const c = text[src]
        if (c === '\\' && src + 1 < lineEnd)
        {
          const esc = text[src + 1]
          src += 2
          switch (esc)
          {
          case 'n': value += '\n'; break
          case 't': value += '\t'; break
          case 'v': value += '\v'; break
          case 'b': value += '\b'; break
          case 'f': value += '\f'; break
          case '"':
          case '\'':
            value += esc
            break
          default:
            // QSS-M Con_Printfs this; developer-only here so a stray backslash cannot spam.
            con.dPrint('LOC_LoadFile: unrecognized escape sequence \\' + esc + ' on line ' + lineno + '\n')
            value += esc
            break
          }
          continue
        }
        if (c === '"')
        {
          trailingQuote = true
          break
        }
        value += c
        ++src
      }

      if (trailingQuote !== true)
      {
        var end = value.length
        while (end > 0 && isBlank(value[end - 1]))
          --end
        value = value.substring(0, end)
      }

      // Fold per value, not over the whole file: a substitution can produce a '"' (guillemets)
      // that would otherwise terminate the value early.
      if (entries.has(key) !== true)
        entries.set(key, foldToCharset(value))
    }

    if (cursor < len)
      ++cursor // skip the newline
  }
}

// QSS-M LOC_LoadFile. True when a table was loaded; a missing file is a no-op, as most
// installs have no rerelease localization file at all.
export const loadFile = async function(file: string)
{
  state.entries.clear()
  if (!file)
    return false

  con.dPrint('\nLanguage initialization\n')

  const buf = await com.loadFile(file)
  if (buf == null)
  {
    con.dPrint('Couldn\'t load \'' + file + '\'\n')
    return false
  }

  var text = new TextDecoder('utf-8').decode(new Uint8Array(buf))
  if (text.charCodeAt(0) === 0xfeff) // BOM
    text = text.substring(1)
  parseFile(text)

  if (state.entries.size === 0)
  {
    con.print('No localized strings in file \'' + file + '\'\n')
    return false
  }

  con.print('Loaded ' + state.entries.size + ' strings from \'' + file + '\'\n')
  return true
}

// FTE PO_Merge_Rerelease's resolution order: language as given, then the mapped locale, then english.
const resolve = async function()
{
  const lang = cvr.lang != null ? cvr.lang.string : ''
  if (lang && await loadFile('localization/loc_' + lang + '.txt'))
    return
  if (lang.length >= 2 && (lang.length === 2 || lang[2] === '-' || lang[2] === '_'))
  {
    const named = LANGUAGE_NAMES[lang.substring(0, 2).toLowerCase()]
    if (named && await loadFile('localization/loc_' + named + '.txt'))
      return
  }
  await loadFile('localization/loc_english.txt')
}

// FTE's loc_%s.txt-then-english resolution, driven from the `lang` cvar (FTE's own cvar name)
// rather than by sniffing the browser, so english stays the guaranteed path. Call after com.init
// has built the searchpaths.
export const init = async function()
{
  cvr.lang = cvar.registerVariable('lang', '', true)
  cvar.registerChangedEvent('lang', () => { void resolve() })
  await resolve()
}

// QSS-M LOC_GetRawString: localized string, or null. Only '$'-prefixed keys are looked up.
export const getRawString = function(key: string)
{
  if (state.entries.size === 0 || !key || key.charCodeAt(0) !== 36 /* '$' */)
    return null
  const value = state.entries.get(key.substring(1))
  return value !== undefined ? value : null
}

// QSS-M LOC_GetString: localized string, or the input string unchanged (never empty).
export const getString = function(key: string)
{
  const value = getRawString(key)
  return value !== null ? value : key
}

// QSS-M LOC_ParseArg: at a '{}' / '{N}' placeholder, writes the argument index to argOut[0] and
// returns the index past the closing brace; -1 when str[i] does not start a placeholder.
const parseArg = function(str: string, i: number, argOut: Int32Array)
{
  if (str[i] !== '{')
    return -1
  var j = i + 1, arg = 0
  for (;;)
  {
    const c = str.charCodeAt(j)
    if (c < 48 || c > 57)
      break
    arg = arg * 10 + (c - 48)
    ++j
  }
  if (str[j] !== '}')
    return -1
  argOut[0] = arg
  return j + 1
}

// QSS-M LOC_HasPlaceholders. False whenever no table is loaded, matching its numindices guard.
export const hasPlaceholders = function(str: string)
{
  if (state.entries.size === 0)
    return false
  for (var i = 0; i < str.length; ++i)
  {
    if (parseArg(str, i, state.argScratch) >= 0)
      return true
  }
  return false
}

// QSS-M LOC_Format: replaces '{}' / '{N}' placeholders with getArg(index), copying malformed
// braces through verbatim and capping output at maxLen-1 chars like the C buffer.
export const format = function(fmt: string, getArg: (idx: number) => string, maxLen: number = MAX_FORMAT)
{
  if (maxLen <= 0)
  {
    con.dPrint('LOC_Format: no output space\n')
    return ''
  }
  const len = maxLen - 1
  var out = '', written = 0, numargs = 0, i = 0
  while (i < fmt.length && written < len)
  {
    const next = parseArg(fmt, i, state.argScratch)
    if (next < 0)
    {
      out += fmt[i++]
      ++written
      continue
    }
    i = next
    ++numargs
    var insert = getArg(state.argScratch[0])
    const spaceLeft = len - written
    if (insert.length > spaceLeft)
    {
      con.dPrint('LOC_Format: overflow at argument #' + numargs + '\n')
      insert = insert.substring(0, spaceLeft)
    }
    out += insert
    written += insert.length
  }
  if (i < fmt.length)
    con.dPrint('LOC_Format: overflow\n')
  return out
}
