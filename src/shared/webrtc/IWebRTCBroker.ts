import { EventEmitter } from '../eventEmitter';

export type MessageEvents = {  
	peerLost: (args: {clientId: string, reason: string}) => void,
	greeting: (args: {gameName: string}) => void,
	newPeer: (args: {clientId: string, iceServers: RTCIceServer[], clientAddress?: string}) => void,
	offer: (args: {clientId: string, offerOrAnswer: RTCSessionDescription}) => void,
	nameInUse: (args: {}) => void,
	candidate: (args: {clientId: string, candidate: RTCIceCandidate}) => void,
	//accept: (args: {clientId: number, offerOrAnswer: RTCSessionDescription}) => void,
	// serverInfo: (args: {})
	// serverUpdate: (args: {})
}

export interface IWebRTCBroker extends EventEmitter<MessageEvents> {
	sendReady(clientId: string): void
	sendRemove(clientId: string): void
	sendOffer(clientId: string, offer: RTCSessionDescription): void
	sendCandidate (clientId: string, candidate: RTCIceCandidate): void

	close: () => void
}