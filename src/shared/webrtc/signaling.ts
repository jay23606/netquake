export interface Signaling {
	send: (data: Uint8Array | string) => void
	onmessage: (callback: (data: Uint8Array | string) => void) => void
	close: () => void
}