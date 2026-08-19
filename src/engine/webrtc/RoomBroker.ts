
import { EventEmitter } from "../../shared/eventEmitter"
import { Signaling } from "../../shared/webrtc/signaling"
import {IWebRTCBroker, MessageEvents} from '../../shared/webrtc/IWebRTCBroker'
import { dPrint } from "../console"

type BrokerMessageType = 'sdp' | 'candidate'
type BrokerMessage = {
	tag: 'broker',
	playerId: string,
	message: {
		type: 'sdp',
		sdp: string
	} | {
		type: 'greeting'
	} | {
		type: 'candidate',
		candidate: string
	} | {
		type: 'ready'
	} | {
		type: 'newPeer',
		iceServers?:  RTCIceServer[]
		clientAddress?: string
	} | {
		type: 'removed'
	}
}

export class RoomBroker 
	extends EventEmitter<MessageEvents> 
	implements IWebRTCBroker {
	signaling: Signaling
	playerId: string

	constructor(signaling: Signaling, playerId: string) {
		super();
		this.playerId = playerId
		this.signaling = signaling
		this.signaling.onmessage(this.onSignal)
	}

	close = () => {
		if (this.signaling){
			this.signaling.close()
		}
	}

	onSignal = (data: string | Uint8Array) => {
		if (typeof data !== 'string') {
			throw 'Unexpected binary data from signaling server'
		}
		const event = JSON.parse(data) as BrokerMessage
		if (event.tag !== 'broker') {
			return
		}
		dPrint(`WebRTC: Received ${event.message.type} from ${event.playerId}\n`)
		switch (event.message.type) {
			case 'greeting':
				this.emit('greeting', {
					gameName: 'n/a'
				})
				return
			case 'sdp':
				this.emit('offer', {
					clientId: event.playerId,
					offerOrAnswer: JSON.parse(event.message.sdp)
				})
				return
			case 'candidate':
				this.emit('candidate', {
					clientId: event.playerId,
					candidate: JSON.parse(event.message.candidate)
				})
				return
			case 'newPeer': 
				this.emit('newPeer', {
					clientId: event.playerId,
					iceServers: event.message.iceServers ?? [],
					clientAddress: event.message.clientAddress
				})
				return
			case 'removed': 
				this.emit('peerLost', {
					clientId: event.playerId,
					reason: ''
				})
				return
			}
	}

	send = (message: BrokerMessage) => {
		dPrint(`WebRTC: Sending ${message.message.type} to ${message.playerId}\n`)
		this.signaling.send(JSON.stringify(message))
	}

	sendRemove = (_clientId: string) => {
		const event: BrokerMessage = {
			tag: 'broker',
			playerId: this.playerId,
			message: {
				type: 'removed'
			}
		}
		this.send(event)
	}
	sendReady = (_clientId: string) => {
		const event: BrokerMessage = {
			tag: 'broker',
			playerId: this.playerId,
			message: {
				type: 'ready'
			}
		}
		this.send(event)
	}
	sendOffer = (clientId: string, offer: RTCSessionDescription) => {
		const event: BrokerMessage = {
			tag: 'broker',
			playerId: clientId,
			message: {
				type: 'sdp',
				sdp: JSON.stringify(offer)
			}
		}
		this.send(event)
	}

	sendCandidate = (clientId: string, candidate: RTCIceCandidate) => {
		const event: BrokerMessage = {
			tag: 'broker',
			playerId: clientId,
			message: {
				type: 'candidate',
				candidate: JSON.stringify(candidate)
			}
		}
		this.send(event)
	}
}
