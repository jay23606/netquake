import sourceMap from 'source-map-js'
import * as StackTraceParser from 'stacktrace-parser'

type SourceMapConsumer = InstanceType<typeof sourceMap.SourceMapConsumer>
type RawSourceMap = ConstructorParameters<typeof sourceMap.SourceMapConsumer>[0]

type ResolvedFrame = {
	file: string | null
	methodName: string | null
	lineNumber: number | null
	column: number | null
}

const consumerCache = new Map<string, SourceMapConsumer | null>()
const consumerPromises = new Map<string, Promise<SourceMapConsumer | null>>()

function loadConsumer(jsUrl: string): Promise<SourceMapConsumer | null> {
	if (consumerCache.has(jsUrl)) {
		return Promise.resolve(consumerCache.get(jsUrl) ?? null)
	}
	const existing = consumerPromises.get(jsUrl)
	if (existing) return existing

	const promise = (async () => {
		try {
			const res = await fetch(jsUrl + '.map')
			if (!res.ok) throw new Error(`map fetch ${res.status}`)
			const raw = (await res.json()) as RawSourceMap
			const consumer = new sourceMap.SourceMapConsumer(raw)
			consumerCache.set(jsUrl, consumer)
			return consumer
		} catch {
			consumerCache.set(jsUrl, null)
			return null
		}
	})()
	consumerPromises.set(jsUrl, promise)
	return promise
}

async function resolveFrame(frame: StackTraceParser.StackFrame): Promise<ResolvedFrame> {
	const fallback: ResolvedFrame = {
		file: frame.file,
		methodName: frame.methodName || null,
		lineNumber: frame.lineNumber,
		column: frame.column,
	}
	if (!frame.file || !frame.lineNumber) return fallback
	const consumer = await loadConsumer(frame.file)
	if (!consumer) return fallback
	const orig = consumer.originalPositionFor({
		line: frame.lineNumber,
		column: frame.column ?? 0,
	})
	if (!orig.source) return fallback
	return {
		file: orig.source,
		methodName: orig.name || frame.methodName || null,
		lineNumber: orig.line ?? null,
		column: orig.column ?? null,
	}
}

function formatFrame(f: ResolvedFrame): string {
	const name = f.methodName || '<anonymous>'
	const file = f.file || '?'
	const line = f.lineNumber ?? '?'
	const col = f.column ?? '?'
	return `    at ${name} (${file}:${line}:${col})`
}

type ReportInput = {
	name?: string
	message?: string
	stack?: string
	filename?: string
	lineno?: number
	colno?: number
}

export async function reportError(input: ReportInput | Error, meta?: Record<string, unknown>): Promise<void> {
	const swetrix = (window as any).swetrix
	if (!swetrix || typeof swetrix.trackError !== 'function') return

	const name = input.name || 'Error'
	const message = input.message || ''
	const stack = (input as any).stack as string | undefined

	let frames: StackTraceParser.StackFrame[] = []
	if (stack) {
		try { frames = StackTraceParser.parse(stack) } catch { frames = [] }
	}

	let resolved: ResolvedFrame[]
	if (frames.length > 0) {
		resolved = await Promise.all(frames.map(resolveFrame))
	} else if ((input as ReportInput).filename) {
		const i = input as ReportInput
		resolved = [await resolveFrame({
			file: i.filename ?? null,
			methodName: null,
			lineNumber: i.lineno ?? null,
			column: i.colno ?? null,
			arguments: [],
		} as any)]
	} else {
		resolved = []
	}

	const top = resolved[0]
	const stackTrace = resolved.length > 0 ? resolved.map(formatFrame).join('\n') : stack

	try {
		swetrix.trackError({
			name: name.substring(0, 200),
			message: message.substring(0, 300),
			filename: top?.file ?? undefined,
			lineno: top?.lineNumber ?? undefined,
			colno: top?.column ?? undefined,
			stackTrace: stackTrace ? stackTrace.substring(0, 1900) : undefined,
			meta,
		})
	} catch {
		// swallow — never let error reporting throw
	}
}

// Custom-event tracking (swetrix.track). Swetrix attaches parsed browser/OS/device to every
// event server-side, so callers only supply the CAUSE — segment by browser in the dashboard.
// Meta values must be short strings; truncate defensively. Never throws, no-op without swetrix.
export function trackEvent(ev: string, meta?: Record<string, unknown>): void {
	try {
		const swetrix = (window as any).swetrix
		if (!swetrix || typeof swetrix.track !== 'function') return
		let m: Record<string, string> | undefined
		if (meta) {
			m = {}
			for (const k of Object.keys(meta)) {
				const v = meta[k]
				if (v == null) continue
				m[k] = String(v).substring(0, 300)
			}
		}
		swetrix.track({ ev, meta: m })
	} catch {
		// swallow — never let telemetry throw
	}
}

// Describe a non-Error rejection/throw reason. JSON.stringify is useless for the two shapes that
// actually reach here: a DOM Event serializes to {"isTrusted":true} (its only OWN enumerable property —
// type/target live on the prototype), and most host objects serialize to {}. Both produced unactionable
// production reports. Reads the useful fields off Events explicitly and falls back to a stringify that
// can't collapse to an empty object.
function describeReason(reason: unknown): string {
	if (typeof reason === 'string') return reason
	if (reason == null) return String(reason)
	if (typeof Event !== 'undefined' && reason instanceof Event) {
		const t: any = reason.target
		// Element/XHR/FileReader targets: whichever locator exists identifies WHAT failed.
		const where = t ? (t.src || t.currentSrc || t.href || t.responseURL || t.url || '') : ''
		const tag = t ? (t.tagName || t.constructor?.name || '') : ''
		const status = t && typeof t.status === 'number' ? ` status=${t.status}` : ''
		// ErrorEvent (script errors) carries a real message/location; a bare Event does not.
		const em = (reason as ErrorEvent).message
		return `${reason.type} event`
			+ (tag ? ` from ${tag}` : '')
			+ (where ? ` (${where})` : '')
			+ status
			+ (em ? `: ${em}` : '')
	}
	if (reason instanceof Error) return reason.message
	// DOMException and friends: name + message are own-ish and meaningful.
	const anyR: any = reason
	if (anyR.name || anyR.message) return `${anyR.name || 'Error'}: ${anyR.message || ''}`
	try {
		const s = JSON.stringify(reason)
		return s && s !== '{}' ? s : Object.prototype.toString.call(reason)
	} catch {
		return Object.prototype.toString.call(reason)
	}
}

// Media that fails to load is COSMETIC and routinely expected in normal operation — third-party map
// thumbnails 404 all the time — so reporting it buries real errors in noise. Anything that genuinely
// needs to know about a failed image handles onerror locally and rejects with a real Error (charmap,
// the asset XHRs). Script/stylesheet failures are NOT in this set: those break the app and are reported.
const COSMETIC_RESOURCE_TAGS = new Set(['IMG', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK'])

export function installGlobalErrorHandlers(): void {
	window.addEventListener('error', (e: ErrorEvent | Event) => {
		const err = (e as ErrorEvent).error
		if (err instanceof Error) {
			void reportError(err)
			return
		}
		// Resource-load failures (<img>/<script>/<link>) deliver a plain Event, NOT an ErrorEvent — it has
		// no message/filename, so describeReason digs the failing URL out of the target instead.
		const ee = e as ErrorEvent
		if (!ee.message && COSMETIC_RESOURCE_TAGS.has((e.target as any)?.tagName))
			return
		void reportError({
			name: ee.message ? 'Error' : 'ResourceError',
			message: ee.message || describeReason(e),
			filename: ee.filename,
			lineno: ee.lineno,
			colno: ee.colno,
		})
	}, true)   // capture: resource-load errors don't bubble

	window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
		const reason = e.reason
		if (reason instanceof Error) {
			void reportError(reason)
		} else {
			void reportError({
				name: 'UnhandledRejection',
				message: describeReason(reason),
			})
		}
	})
}
