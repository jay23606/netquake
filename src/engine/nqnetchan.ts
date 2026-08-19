/**
 * nqnetchan.ts — NQ netchan protocol framing
 *
 * Pure transport-agnostic module. Works on top of any raw byte channel
 * (WebRTC data channel, WebSocket, etc.) that speaks FTE/NQ netchan.
 */

import IDatagram from './interfaces/net/IDatagram'

const NETFLAG_DATA       = 0x00010000
const NETFLAG_ACK        = 0x00020000
const NETFLAG_EOM        = 0x00080000
const NETFLAG_UNRELIABLE = 0x00100000
const NETFLAG_CTL        = 0x80000000

const CCREQ_CONNECT = 0x01
const CCREP_ACCEPT  = 0x81

export type Packet =
	| { type: 'data',       sequence: number, payload: Uint8Array, eom: boolean }
	| { type: 'unreliable', sequence: number, payload: Uint8Array }
	| { type: 'ack',        sequence: number }
	| { type: 'ctl',        payload: Uint8Array }
	| { type: 'unknown' }

export function parse(buffer: ArrayBuffer, cursize: number): Packet {
	if (cursize < 4) return { type: 'unknown' }
	const view = new DataView(buffer)
	const flagsLen = view.getUint32(0, false) // big-endian
	const flags    = flagsLen & 0xffff0000

	if (flags & NETFLAG_CTL) {
		return { type: 'ctl', payload: new Uint8Array(buffer, 4, cursize - 4) }
	}
	if (cursize < 8) return { type: 'unknown' }
	const sequence = view.getUint32(4, false)
	if (flags & NETFLAG_ACK) {
		return { type: 'ack', sequence }
	}
	if (flags & NETFLAG_DATA) {
		return { type: 'data', sequence, payload: new Uint8Array(buffer, 8, cursize - 8), eom: !!(flags & NETFLAG_EOM) }
	}
	if (flags & NETFLAG_UNRELIABLE) {
		return { type: 'unreliable', sequence, payload: new Uint8Array(buffer, 8, cursize - 8) }
	}
	return { type: 'unknown' }
}

export function isCCREPAccept(buffer: ArrayBuffer): boolean {
	if (buffer.byteLength < 5) return false
	const view = new DataView(buffer)
	const flags = view.getUint32(0, false)
	return !!(flags & NETFLAG_CTL) && view.getUint8(4) === CCREP_ACCEPT
}

export function buildCCREQ(): ArrayBuffer {
	// CTL payload: CCREQ_CONNECT(1) + "QUAKE\0"(6) + version(1) = 8 bytes
	// Total: 4-byte header + 8 = 12 bytes
	const payload = new Uint8Array([CCREQ_CONNECT, 0x51, 0x55, 0x41, 0x4B, 0x45, 0x00, 0x03])
	const buf = new ArrayBuffer(4 + payload.length)
	new DataView(buf).setUint32(0, NETFLAG_CTL | buf.byteLength, false)
	new Uint8Array(buf).set(payload, 4)
	return buf
}

export function buildACK(sequence: number): ArrayBuffer {
	const buf = new ArrayBuffer(8)
	const view = new DataView(buf)
	view.setUint32(0, NETFLAG_ACK | 8, false)
	view.setUint32(4, sequence, false)
	return buf
}

export function wrapData(data: IDatagram, sequence: number): ArrayBuffer {
	const len = 8 + data.cursize
	const buf = new ArrayBuffer(len)
	const view = new DataView(buf)
	view.setUint32(0, NETFLAG_DATA | NETFLAG_EOM | len, false)
	view.setUint32(4, sequence, false)
	new Uint8Array(buf).set(new Uint8Array(data.data, 0, data.cursize), 8)
	return buf
}

export function wrapUnreliable(data: IDatagram, sequence: number): ArrayBuffer {
	const len = 8 + data.cursize
	const buf = new ArrayBuffer(len)
	const view = new DataView(buf)
	view.setUint32(0, NETFLAG_UNRELIABLE | len, false)
	view.setUint32(4, sequence, false)
	new Uint8Array(buf).set(new Uint8Array(data.data, 0, data.cursize), 8)
	return buf
}
