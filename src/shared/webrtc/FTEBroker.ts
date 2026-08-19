import { EventEmitter } from "../eventEmitter"
import { IWebRTCBroker, MessageEvents } from "./IWebRTCBroker"
import { Signaling } from "./signaling"

export type NewPeerMessage = {
	iceServers: RTCIceServer[]
	clientAddress?: string
}

enum FTEBrokerMessageType
{
	// shared by rtcpeers+broker
	PEERLOST=0,		//other side dropped connection
	GREETING=1,		//master telling us our unique game name
	NEWPEER=2,		//relay established, send an offer now.
	OFFER=3,		//peer's initial details
	CANDIDATE=4,	//candidate updates. may arrive late as new ones are discovered.
	ACCEPT=5,		//go go go (response from offer) (Not Implemented)
	SERVERINFO=6,	//server->broker (for advertising the server properly)
	SERVERUPDATE=7,	//broker->browser (for querying available server lists)
	NAMEINUSE=8,	//requested resource is unavailable.
};

const decodeText = (buffer: Uint8Array) => new TextDecoder().decode(buffer)
const encodeText = (text: string) => new TextEncoder().encode(text)

const parseRelay = (relayString: string): RTCIceServer => {
	const parts = relayString.split('?')
	const base = {urls: [parts[0]]}
	if (parts.length > 1) {
		const params = parts.slice(1).reduce((acc, param) => {
			const [key, value] = param.split('=')
			acc[key] = value
			return acc
		}, {} as Record<string, string>)
		return {
			...base,
			username: params['user'],
			credential: params['auth']
		}
	}
	return base
}
 
const parseNewPeerMessage = (text: string): NewPeerMessage => {
	// Split by null terminators
	const parts = text.split('\0')

	// First part is the client address
	const clientAddress = parts[0]

	// Second part is space-separated relay URLs (FTEQW/QSS broker protocol).
	// The broker sends all ICE server URLs in a single null-terminated string,
	// space-separated. Split by whitespace to get individual URLs.
	const relayString = parts.length > 1 ? parts[1] : ''
	const relayUrls = relayString.split(/\s+/).filter(s => s.length > 0)

	return {
		clientAddress,
		iceServers: relayUrls.length > 0 ? relayUrls.map(parseRelay) : []
	}
}

export class FTEBroker 
	extends EventEmitter<MessageEvents> 
	implements IWebRTCBroker  {
	signaling: Signaling
	
	constructor(signaling: Signaling) {
		super();
		this.signaling = signaling
		this.signaling.onmessage(this.onSignal)
	}

	close = () => {
		if (this.signaling){
			this.signaling.close()
		}
	}

	onSignal = (data: Uint8Array | string) => {
		if (typeof data === 'string') {
			throw 'Unexpected string from signaling server'
		}
		const bufferData = new Uint8Array(data)
		const cmd = bufferData[0] as FTEBrokerMessageType
		let clientId = bufferData[1] | bufferData[2] << 8

		const msg = decodeText(bufferData.subarray(3))
		switch (cmd) {
			case FTEBrokerMessageType.GREETING:
				const gameName = msg
				this.emit('greeting', {gameName})
				return
		  case FTEBrokerMessageType.PEERLOST:	//the broker lost its connection to our peer...
				const reason = msg
				this.emit('peerLost', {clientId: clientId.toString(), reason: reason || '<NO REASON>'})
				return
			case FTEBrokerMessageType.NEWPEER:
				// msg will be a list of relay addresses
				const parsedMessage = parseNewPeerMessage(msg)
				this.emit('newPeer', {
					clientId: clientId.toString(), 
					iceServers: parsedMessage.iceServers,
					clientAddress: parsedMessage.clientAddress
				})
				return
			case FTEBrokerMessageType.OFFER:
				const offerText = msg
				const offer = offerText.startsWith('{') 
					? JSON.parse(offerText) 
					: 	{
							sdp: offerText, 
							type: "answer"
						}
				this.emit('offer', {clientId: clientId.toString(), offerOrAnswer: offer})
				return
			case FTEBrokerMessageType.CANDIDATE:
				// Broker-based connections send JSON; rtc://udp/ path sends raw SDP lines
				if (msg.startsWith('{')) {
					const candidate = JSON.parse(msg)
					this.emit('candidate', {clientId: clientId.toString(), candidate})
				} else {
					// Plain SDP lines, possibly multiple separated by newlines (from ice_scand)
					for (const line of msg.split('\n')) {
						const trimmed = line.trim()
						if (!trimmed) continue
						const sdp = trimmed.startsWith('a=') ? trimmed.substring(2) : trimmed
						this.emit('candidate', {
							clientId: clientId.toString(), 
							candidate: { candidate: sdp, sdpMid: '0', sdpMLineIndex: 0 } as RTCIceCandidate
						})
					}
				}
				return
			case FTEBrokerMessageType.NAMEINUSE:
				this.emit('nameInUse', {})
				return
		  }
	}

	sendReady(clientId: string): void {
		// nop - not used.
	}
	sendRemove(clientId: string): void {
		// nop - not used.
	}
	sendPayload = (clientId: string, type: FTEBrokerMessageType, payload: Uint8Array) => {
		const _clientId = parseInt(clientId)
		const data = new Uint8Array(3 + payload.byteLength)
		data[0] = type
		data[1] = _clientId & 0xff
		data[2] = (_clientId >> 8) & 0xff
		data.set(new Uint8Array(payload), 3)

		this.signaling.send(data)
	}

	sendOffer = (clientId: string, offer: RTCSessionDescriptionInit) => {
		const msg = encodeText(JSON.stringify(offer))
		this.sendPayload(clientId, FTEBrokerMessageType.OFFER, msg)
	}

	sendCandidate = (clientId: string, candidate: RTCIceCandidate) => {
		const msg = encodeText(JSON.stringify(candidate))
		this.sendPayload(clientId, FTEBrokerMessageType.CANDIDATE, msg)
	}
}
