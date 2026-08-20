import { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase, iceServers } from './client'

// Voice chat over its own WebRTC mesh.
//
// This deliberately does NOT reuse the game's peer connections. Quake is
// client/server, so the game signalling is a star: every client connects to the
// host and, in SupabaseBroker's words, "clients ignore each other". Voice on
// that shape would mean everyone hears the host and nobody hears each other.
//
// So voice gets its own channel and its own full mesh. Two consequences worth
// keeping: the game handshake is untouched, so a voice failure can never
// disturb gameplay; and adding a track never renegotiates a game connection.
//
// Audio is attached when a connection is built, not when the mic is unmuted.
// Adding a track to a live connection triggers renegotiation -- a fresh
// offer/answer in the middle of a match. Muting instead flips `track.enabled`,
// which is instant and cannot fail.

const SIGNAL_EVENT = 'voice-signal'

type VoiceSignal = {
	type: 'sdp' | 'ice'
	from: string
	to: string
	data: string
}

export type VoiceStatus =
	| 'off'
	| 'starting'
	| 'live'
	| 'denied'        // the browser refused, usually no permission
	| 'unavailable'   // no microphone, or an insecure context

export type VoiceListener = (status: VoiceStatus, detail?: string) => void

const log = (msg: string) => console.log('[voice]', msg)

export class VoiceChat {
	private readonly roomId: string
	private readonly playerId: string

	private channel: RealtimeChannel | null = null
	private stream: MediaStream | null = null
	private peers = new Map<string, RTCPeerConnection>()
	private remoteAudio = new Map<string, HTMLAudioElement>()
	// Candidates can arrive before the description they belong to; adding one
	// early throws, so they wait here until there is a remote description.
	private pendingIce = new Map<string, RTCIceCandidateInit[]>()

	private status: VoiceStatus = 'off'
	private listeners = new Set<VoiceListener>()
	private mutedFlag = true

	constructor(roomId: string, playerId: string) {
		this.roomId = roomId
		this.playerId = playerId
	}

	get muted(): boolean { return this.mutedFlag }
	get currentStatus(): VoiceStatus { return this.status }
	get peerCount(): number { return this.peers.size }

	onStatus = (listener: VoiceListener): (() => void) => {
		this.listeners.add(listener)
		listener(this.status)
		return () => { this.listeners.delete(listener) }
	}

	private setStatus = (status: VoiceStatus, detail?: string) => {
		this.status = status
		this.listeners.forEach(l => l(status, detail))
	}

	// Must be called from a user gesture: getUserMedia prompts for permission,
	// and browsers block audio playback that no interaction asked for.
	start = async (): Promise<VoiceStatus> => {
		if (this.status === 'live' || this.status === 'starting') return this.status
		this.setStatus('starting')

		if (!navigator.mediaDevices?.getUserMedia) {
			// getUserMedia is absent outside a secure context, which is the usual
			// cause here -- http://<lan-ip> during local testing rather than https.
			this.setStatus('unavailable', 'microphone access needs a secure context')
			return this.status
		}

		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
				video: false,
			})
		} catch (err) {
			const name = (err as DOMException)?.name
			const denied = name === 'NotAllowedError' || name === 'SecurityError'
			this.setStatus(denied ? 'denied' : 'unavailable', String(name ?? err))
			return this.status
		}

		// Start muted. Opening a live mic the instant a player joins is a
		// surprise nobody wants.
		this.applyMute()

		try {
			await this.openChannel()
		} catch (err) {
			this.stopTracks()
			this.setStatus('unavailable', String(err))
			return this.status
		}

		this.setStatus('live')
		return this.status
	}

	stop = (): void => {
		this.peers.forEach((pc, id) => { pc.close(); this.dropAudio(id) })
		this.peers.clear()
		this.pendingIce.clear()
		this.stopTracks()
		if (this.channel) {
			void getSupabase().removeChannel(this.channel)
			this.channel = null
		}
		this.mutedFlag = true
		this.setStatus('off')
	}

	setMuted = (muted: boolean): void => {
		this.mutedFlag = muted
		this.applyMute()
	}

	toggleMuted = (): boolean => {
		this.setMuted(!this.mutedFlag)
		return this.mutedFlag
	}

	private applyMute = () => {
		this.stream?.getAudioTracks().forEach(t => { t.enabled = !this.mutedFlag })
	}

	private stopTracks = () => {
		this.stream?.getTracks().forEach(t => t.stop())
		this.stream = null
	}

	private openChannel = async (): Promise<void> => {
		const supabase = getSupabase()
		const channel = supabase.channel(`netquake:voice:${this.roomId}`, {
			config: {
				broadcast: { self: false, ack: true },
				presence: { key: this.playerId },
			},
		})

		channel.on('broadcast', { event: SIGNAL_EVENT }, ({ payload }) => {
			void this.onSignal(payload as VoiceSignal)
		})

		// Presence is the peer list. Sync fires with everyone currently present,
		// which covers both joining an occupied room and being joined.
		channel.on('presence', { event: 'sync' }, () => {
			Object.keys(channel.presenceState())
				.filter(k => k !== this.playerId)
				.forEach(k => { void this.ensurePeer(k) })
		})

		channel.on('presence', { event: 'leave' }, ({ key }: { key: string }) => {
			if (key === this.playerId) return
			this.dropPeer(key)
		})

		this.channel = channel

		await new Promise<void>((resolve, reject) => {
			channel.subscribe((status, err) => {
				if (status === 'SUBSCRIBED') {
					void channel.track({ playerId: this.playerId, at: Date.now() })
					resolve()
					return
				}
				if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
					reject(err ?? new Error(`voice signalling failed: ${status}`))
				}
			})
		})
	}

	private send = (signal: VoiceSignal) => {
		void this.channel?.send({ type: 'broadcast', event: SIGNAL_EVENT, payload: signal })
	}

	// Exactly one side of each pair must offer, or both offer at once and the
	// negotiation collides. Comparing ids gives both peers the same answer
	// without needing a host, which voice has no concept of.
	private shouldOffer = (peerId: string) => this.playerId < peerId

	private newConnection = (peerId: string): RTCPeerConnection => {
		const pc = new RTCPeerConnection({ iceServers: iceServers() })
		this.peers.set(peerId, pc)

		const stream = this.stream
		if (stream) {
			stream.getAudioTracks().forEach(track => { pc.addTrack(track, stream) })
		}

		pc.addEventListener('icecandidate', event => {
			if (!event.candidate) return
			this.send({
				type: 'ice',
				from: this.playerId,
				to: peerId,
				data: JSON.stringify(event.candidate.toJSON()),
			})
		})

		pc.addEventListener('track', event => {
			const [remote] = event.streams
			if (remote) this.attachAudio(peerId, remote)
		})

		pc.addEventListener('connectionstatechange', () => {
			log(`peer ${peerId}: ${pc.connectionState}`)
			if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
				this.dropPeer(peerId)
			}
		})

		return pc
	}

	private ensurePeer = async (peerId: string): Promise<void> => {
		if (this.peers.has(peerId) || !this.stream) return
		const pc = this.newConnection(peerId)
		if (!this.shouldOffer(peerId)) return // they will offer to us

		const offer = await pc.createOffer()
		await pc.setLocalDescription(offer)
		this.send({
			type: 'sdp',
			from: this.playerId,
			to: peerId,
			data: JSON.stringify(offer),
		})
	}

	private onSignal = async (signal: VoiceSignal): Promise<void> => {
		if (!signal || signal.from === this.playerId || signal.to !== this.playerId) return
		if (!this.stream) return

		if (signal.type === 'ice') {
			const candidate = JSON.parse(signal.data) as RTCIceCandidateInit
			const known = this.peers.get(signal.from)
			if (!known?.remoteDescription) {
				const queue = this.pendingIce.get(signal.from) ?? []
				queue.push(candidate)
				this.pendingIce.set(signal.from, queue)
				return
			}
			try { await known.addIceCandidate(candidate) } catch { /* stale candidate */ }
			return
		}

		const description = JSON.parse(signal.data) as RTCSessionDescriptionInit
		const pc = this.peers.get(signal.from) ?? this.newConnection(signal.from)
		await pc.setRemoteDescription(description)
		await this.drainIce(signal.from, pc)

		if (description.type !== 'offer') return
		const answer = await pc.createAnswer()
		await pc.setLocalDescription(answer)
		this.send({
			type: 'sdp',
			from: this.playerId,
			to: signal.from,
			data: JSON.stringify(answer),
		})
	}

	private drainIce = async (peerId: string, pc: RTCPeerConnection): Promise<void> => {
		const queued = this.pendingIce.get(peerId)
		if (!queued) return
		this.pendingIce.delete(peerId)
		for (const candidate of queued) {
			try { await pc.addIceCandidate(candidate) } catch { /* stale candidate */ }
		}
	}

	// Remote audio needs a real element to play through. It stays out of the
	// layout and off the accessibility tree: it is a speaker, not a control.
	private attachAudio = (peerId: string, stream: MediaStream) => {
		let el = this.remoteAudio.get(peerId)
		if (!el) {
			el = document.createElement('audio')
			el.autoplay = true
			el.setAttribute('aria-hidden', 'true')
			el.style.display = 'none'
			document.body.appendChild(el)
			this.remoteAudio.set(peerId, el)
		}
		el.srcObject = stream
		void el.play().catch(() => { /* blocked until a gesture; the toggle retries */ })
	}

	private dropAudio = (peerId: string) => {
		const el = this.remoteAudio.get(peerId)
		if (!el) return
		el.srcObject = null
		el.remove()
		this.remoteAudio.delete(peerId)
	}

	private dropPeer = (peerId: string) => {
		const pc = this.peers.get(peerId)
		if (pc) { pc.close(); this.peers.delete(peerId) }
		this.pendingIce.delete(peerId)
		this.dropAudio(peerId)
	}
}
