import { RealtimeChannel } from '@supabase/supabase-js'
import { EventEmitter } from '../../shared/eventEmitter'
import { IWebRTCBroker, MessageEvents } from '../../shared/webrtc/IWebRTCBroker'
import { getSupabase, iceServers } from '../../shared/supabase/client'

// The lobby constructs this broker before the engine boots, so it cannot use the
// engine console: dPrint reads host.cvr.developer, which does not exist until
// host.init has registered cvars.
const dbg = (msg: string) => console.log("[supabase-signal]", msg.trim())

// Signaling over Supabase Realtime.
//
// Only SDP offers/answers and ICE candidates cross this channel -- a few dozen
// small messages per peer, once, at connect time. Gameplay runs on the WebRTC
// DataChannel that these messages establish and never touches Supabase.
//
// Addressing: the legacy room server rewrote the `playerId` field in transit
// (outbound it meant "recipient", inbound it meant "sender"). There is no server
// hop here, so every payload carries explicit `from`/`to` and each peer filters
// for itself. `to: null` means "everyone in the room".

type SignalType = 'ready' | 'newPeer' | 'sdp' | 'candidate' | 'removed'

type Signal = {
	type: SignalType
	from: string
	to: string | null
	data?: string
}

const SIGNAL_EVENT = 'signal'

export class SupabaseBroker
	extends EventEmitter<MessageEvents>
	implements IWebRTCBroker {

	private channel: RealtimeChannel | null = null
	private readonly roomId: string
	private readonly playerId: string
	private readonly isHost: boolean
	private knownPeers = new Set<string>()

	// Realtime broadcast has no replay, and webrtc.ts only attaches its handlers
	// when the engine boots at /mp/quake -- which can be well after this channel
	// went live in the lobby. Anything arriving in that gap would be emitted to
	// nobody, so it is buffered and flushed once handlers exist.
	private pending: Signal[] = []
	private handlersAttached = false
	private flushScheduled = false

	// Role and room in every line: comparing two consoles is the fastest way to
	// spot peers that think they are in different rooms.
	private log = (msg: string) =>
		dbg(`[${this.isHost ? 'host' : 'client'}][${this.roomId.slice(0, 8)}] ${msg}`)

	constructor(roomId: string, playerId: string, isHost: boolean) {
		super()
		this.roomId = roomId
		this.playerId = playerId
		this.isHost = isHost
	}

	// Subscribes and resolves once the channel is live. Callers must await this
	// before sending, otherwise early signals are dropped on the floor.
	connect = async (): Promise<void> => {
		const supabase = getSupabase()
		const channel = supabase.channel(`netquake:room:${this.roomId}`, {
			config: {
				broadcast: { self: false, ack: true },
				presence: { key: this.playerId },
			},
		})

		channel.on('broadcast', { event: SIGNAL_EVENT }, ({ payload }) =>
			this.onSignal(payload as Signal))

		// Presence is the safety net for peers that vanish without sending
		// 'removed' (tab closed, network dropped, browser crashed).
		channel.on('presence', { event: 'leave' }, ({ key }: { key: string }) => {
			if (key === this.playerId || !this.knownPeers.has(key)) return
			this.knownPeers.delete(key)
			this.log(`peer ${key} left the room\n`)
			this.emit('peerLost', { clientId: key, reason: 'left the room' })
		})

		this.channel = channel

		await new Promise<void>((resolve, reject) => {
			channel.subscribe((status, err) => {
				if (status === 'SUBSCRIBED') {
					channel.track({ playerId: this.playerId, at: Date.now() })
					resolve()
					return
				}
				if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
					reject(err ?? new Error(`Supabase signaling failed: ${status}`))
				}
			})
		})

		this.log(`signaling connected to room ${this.roomId}\n`)
		this.emit('greeting', { gameName: 'netquake' })
	}

	// Buffers until webrtc.ts has attached its handlers, then hands over.
	private onSignal = (signal: Signal) => {
		if (!this.handlersAttached) {
			this.pending.push(signal)
			return
		}
		this.dispatch(signal)
	}

	// initBroker registers several handlers in one synchronous run, so the flush
	// is deferred a microtask to let all of them land before replaying.
	on = <K extends keyof MessageEvents>(event: K, listener: MessageEvents[K]) => {
		super.on(event, listener)
		if (this.flushScheduled) return
		this.flushScheduled = true
		queueMicrotask(() => {
			this.handlersAttached = true
			const queued = this.pending
			this.pending = []
			if (queued.length) this.log(`replaying ${queued.length} buffered signal(s)`)
			queued.forEach((s) => this.dispatch(s))
		})
	}

	private dispatch = (signal: Signal) => {
		if (!signal || signal.from === this.playerId) return
		if (signal.to !== null && signal.to !== this.playerId) return

		this.log(`received ${signal.type} from ${signal.from}\n`)

		switch (signal.type) {
			case 'ready':
				// Only the host accepts arrivals; clients ignore each other.
				if (!this.isHost) return
				this.knownPeers.add(signal.from)
				this.emit('newPeer', {
					clientId: signal.from,
					iceServers: iceServers(),
				})
				// The client branch of webrtc.ts's newPeer handler is what builds
				// the offer, so the client needs a newPeer of its own naming this
				// host. Without it the host answers an offer that never arrives.
				this.send('newPeer', signal.from)
				return

			case 'newPeer':
				// The host announcing itself to a client that just joined.
				if (this.isHost) return
				this.knownPeers.add(signal.from)
				this.emit('newPeer', {
					clientId: signal.from,
					iceServers: iceServers(),
				})
				return

			case 'sdp':
				this.knownPeers.add(signal.from)
				this.emit('offer', {
					clientId: signal.from,
					offerOrAnswer: JSON.parse(signal.data!) as RTCSessionDescription,
				})
				return

			case 'candidate':
				this.emit('candidate', {
					clientId: signal.from,
					candidate: JSON.parse(signal.data!) as RTCIceCandidate,
				})
				return

			case 'removed':
				this.knownPeers.delete(signal.from)
				this.emit('peerLost', { clientId: signal.from, reason: 'disconnected' })
				return
		}
	}

	private send = (type: SignalType, to: string | null, data?: string) => {
		if (!this.channel) {
			this.log(`dropped ${type} -- signaling not connected\n`)
			return
		}
		this.log(`sending ${type} to ${to ?? 'room'}\n`)
		void this.channel.send({
			type: 'broadcast',
			event: SIGNAL_EVENT,
			payload: { type, from: this.playerId, to, data } satisfies Signal,
		})
	}

	sendReady = (_clientId: string) => this.send('ready', null)

	sendRemove = (_clientId: string) => this.send('removed', null)

	sendOffer = (clientId: string, offer: RTCSessionDescription) =>
		this.send('sdp', clientId, JSON.stringify(offer))

	sendCandidate = (clientId: string, candidate: RTCIceCandidate) =>
		this.send('candidate', clientId, JSON.stringify(candidate))

	close = () => {
		if (!this.channel) return
		this.send('removed', null)
		void this.channel.unsubscribe()
		this.channel = null
		this.knownPeers.clear()
		this.log('signaling closed')
	}
}
