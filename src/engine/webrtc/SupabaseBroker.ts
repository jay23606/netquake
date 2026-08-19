import { RealtimeChannel } from '@supabase/supabase-js'
import { EventEmitter } from '../../shared/eventEmitter'
import { IWebRTCBroker, MessageEvents } from '../../shared/webrtc/IWebRTCBroker'
import { getSupabase, iceServers } from '../../shared/supabase/client'
import { dPrint } from '../console'

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

type SignalType = 'ready' | 'sdp' | 'candidate' | 'removed'

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
			dPrint(`Supabase: peer ${key} left the room\n`)
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

		dPrint(`Supabase: signaling connected to room ${this.roomId}\n`)
		this.emit('greeting', { gameName: 'netquake' })
	}

	private onSignal = (signal: Signal) => {
		if (!signal || signal.from === this.playerId) return
		if (signal.to !== null && signal.to !== this.playerId) return

		dPrint(`Supabase: received ${signal.type} from ${signal.from}\n`)

		switch (signal.type) {
			case 'ready':
				// Only the host accepts new peers; clients ignore each other's
				// arrival, exactly as the room server's fan-out behaved.
				if (!this.isHost) return
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
			dPrint(`Supabase: dropped ${type} -- signaling not connected\n`)
			return
		}
		dPrint(`Supabase: sending ${type} to ${to ?? 'room'}\n`)
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
		dPrint('Supabase: signaling closed\n')
	}
}
