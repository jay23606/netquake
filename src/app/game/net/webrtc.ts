import ISocket from '../../../engine/interfaces/net/ISocket'
import IDatagram from '../../../engine/interfaces/net/IDatagram'
import * as net from '../../../engine/net'
import * as sz from '../../../engine/sz'
import { print } from '../sys'
import { QConnectStatus } from '../../../engine/interfaces/net/INetworkDriver'
import { defaultConfiguration } from '../../../shared/webrtc/configuration'
import { FTEBroker } from '../../../shared/webrtc/FTEBroker'
import { Signaling } from '../../../shared/webrtc/signaling'
import { IWebRTCBroker } from '../../../shared/webrtc/IWebRTCBroker'
import * as sys from '../sys'
import * as cvar from '../../../engine/cvar'

export const name: string = "webrtc"
export var initialized: boolean = false;
export var available: boolean = false;

const cvr: { debug?: cvar.CVar, broker?: cvar.CVar } = {}
const dbg = (...args: Parameters<typeof console.log>) => { if (cvr.debug?.value) console.log(...args) }
const dbgGroup = (label: string, body: () => void) => {
	if (!cvr.debug?.value) return
	console.groupCollapsed(label); body(); console.groupEnd()
}

const defaultBrokerAddress = 'wss://master.quakeone.com:27950'

let websocket: WebSocket = null

type Role = 'client' | 'server'

type WebRTCHostState = {
	currentRole: 'server'
	broker: IWebRTCBroker
	acceptSockets: WebRTCDriver[],
	webRtcClients: Record<string, WebRTCDriver>
}
type WebRTCState = {
	currentRole: Role
	broker: IWebRTCBroker,

	// As Client
	webRtcDriver: WebRTCDriver | null

	// As Server
	acceptSockets: WebRTCDriver[],
	webRtcClients: Record<string, WebRTCDriver>

}

const state: WebRTCState = {
	currentRole: 'client',
	broker: null,
  acceptSockets: [],
  webRtcClients: {},
	webRtcDriver: null
}

// The frontend supplies an already-connected broker for Supabase-hosted rooms
// (SupabaseBroker.connect is async, so the app awaits it and injects the result).
// There is no fallback any more: the legacy room-server flow that used to build
// one over an injected WebSocket has been removed.
const roomBroker = (): IWebRTCBroker | null => sys.state.initArgs.broker ?? null

const createSignaling = (ws: WebSocket): Signaling => {
	let eventToMessageHandler: (event: MessageEvent) => void
	return { 
		send: (data: Uint8Array | string) => {
			ws.send(data)
		},
		onmessage: (messageHandler: (data: Uint8Array | string) => void) => {
			eventToMessageHandler = (event: MessageEvent) => messageHandler(event.data)
			ws.addEventListener('message', eventToMessageHandler)
		},
		close: () => {
			if (eventToMessageHandler){
				ws.removeEventListener('message', eventToMessageHandler)
			}
		}
	}
}

export type WebRTCDriver = {
	rtc: RTCPeerConnection
	channel: RTCDataChannel
	identifier: string
	candidateCache: RTCIceCandidate[]
	clientAddress?: string
}

export const supportedAddress = (connectionAddress: string) => {
	return connectionAddress.substring(0, 6) === 'rtc://'
}

type ParsedRtcUri = {
	// Broker websocket URL, or null to fall back to the net_ice_broker cvar.
	brokerUrl: string | null
	// FTE resource (game/host) name appended to /FTE-Quake/.
	resource: string
}

// `udp` is a reserved leading segment for a direct-connect resource
// (e.g. rtc://udp/52.14.57.255:26202, built from an ice-udp endpoint). The slash there
// separates the transport from the address, NOT a broker host from a resource, so the
// whole thing stays as the resource against the default broker.
const FTE_DIRECT_PREFIX = 'udp'

// Parse an rtc:// URI into an optional broker host and the FTE resource name.
//   rtc://gamename                          -> broker: cvar default, resource: gamename
//   rtc://broker.example.com:27950/gamename -> broker: wss://broker.example.com:27950, resource: gamename
//   rtc://udp/52.14.57.255:26202            -> broker: cvar default, resource: udp/52.14.57.255:26202
// A bare host[:port] authority is assumed to be a secure websocket (wss://).
const parseRtcUri = (host: string): ParsedRtcUri => {
	const rest = host.substring(6) // strip "rtc://"
	const slash = rest.indexOf('/')
	if (slash === -1) {
		return { brokerUrl: null, resource: rest }
	}
	const authority = rest.substring(0, slash)
	if (authority.toLowerCase() === FTE_DIRECT_PREFIX) {
		return { brokerUrl: null, resource: rest }
	}
	const resource = rest.substring(slash + 1)
	const brokerUrl = /^wss?:\/\//i.test(authority) ? authority : `wss://${authority}`
	return { brokerUrl, resource }
}

export const init = () => { 
	if(typeof window === "undefined")
		return
	if (window['WebSocket'] == null)
		return;

	cvr.debug = cvar.registerVariable('net_webrtc_debug', '1')
	cvr.broker = cvar.registerVariable('net_ice_broker', defaultBrokerAddress)
	available = true;
	initialized = true
	return true;
};


export const listen = () => {
	state.currentRole = 'server'
	const injected = roomBroker()
	if (sys.state.initArgs.isHost && injected) {
		// The frontend connects the signaling broker and injects it here.
		initBroker(injected)
	} else {
		const wsHost = `${cvr.broker.string}/FTE-Quake/${net.cvr.hostname.string}`
		websocket = new WebSocket(wsHost, ['rtc_host'])
		websocket.binaryType = "arraybuffer";

		initBroker(new FTEBroker(createSignaling(websocket)))
	}
	state.broker.sendReady('0')
}


const initBroker = (broker: IWebRTCBroker) => {
	state.broker = broker
	state.broker.on('greeting', ({gameName}) => {
		dbg(`[webrtc] broker greeting: gameName=${gameName}`)
		print(`WebRTC: Connected to broker for ${gameName}\n`)
	})

	state.broker.on('peerLost', ({clientId, reason}) => {
		dbg(`[webrtc] broker peerLost: clientId=${clientId} reason=${reason}`)
	})

	state.broker.on('nameInUse', () => {
		dbg('[webrtc] broker nameInUse')
	})

	state.broker.on('newPeer', async ({ clientId, iceServers, clientAddress }) => {
		dbg(`[webrtc] broker newPeer: clientId=${clientId} clientAddress=${clientAddress} iceServers=`, iceServers)

		if (state.currentRole === 'server') {
			acceptNewConnection(clientId, iceServers, clientAddress)
		} else {
			if (iceServers?.length) {
				state.webRtcDriver.rtc.setConfiguration({
					...defaultConfiguration,
					iceServers: [...defaultConfiguration.iceServers, ...iceServers]
				})
			}
			state.webRtcDriver.identifier = clientId
			const offer = await state.webRtcDriver.rtc.createOffer()
			dbgGroup('[webrtc] created offer SDP', () => console.log(offer.sdp))

			await state.webRtcDriver.rtc.setLocalDescription(offer)
			state.broker.sendOffer(state.webRtcDriver.identifier, offer as RTCSessionDescription)
		}
	})

	state.broker.on('offer', async ({clientId, offerOrAnswer}) => {
		let driver: WebRTCDriver
		dbgGroup(`[webrtc] received ${offerOrAnswer.type} SDP from ${clientId}`, () => console.log(offerOrAnswer.sdp))
		if (state.currentRole === 'server') {
			driver = state.webRtcClients[clientId]
			if (!driver) {
				print(`WebRTC: Could not find client for ${clientId}\n`)
				return
			}

			await driver.rtc.setRemoteDescription(offerOrAnswer)
			const answer = await driver.rtc.createAnswer()
			dbgGroup('[webrtc] created answer SDP', () => console.log(answer.sdp))
			await driver.rtc.setLocalDescription(answer)

			state.broker.sendOffer(clientId, answer as RTCSessionDescription)
		} else {
			driver = state.webRtcDriver
			await driver.rtc.setRemoteDescription(offerOrAnswer)
		}
		if (driver.rtc.remoteDescription) {
			for (let i = 0; i < driver.candidateCache.length; i++) {
				await driver.rtc.addIceCandidate(driver.candidateCache[i])
			}
			driver.candidateCache = []
		}
	})

	state.broker.on('candidate', async ({clientId, candidate}) => {
		if (!candidate) return
		dbg(`[webrtc] received candidate from ${clientId}:`, candidate.candidate)
		const driver = state.currentRole === 'server' ? state.webRtcClients[clientId] : state.webRtcDriver;
		if (!driver) {
			print(`WebRTC: Could not find client for ${clientId}\n`)
			return
		}
		if (!driver.rtc.remoteDescription) {
			driver.candidateCache.push(candidate)
		}

		try {
			await driver.rtc.addIceCandidate(candidate)
		} catch(e) {
			print('WebRTC: Failed to add ice candidate: ' + e.message)
		}
	})
}

export const connect = async (host: string): Promise<QConnectStatus> =>
{
	const isRoom = host === 'rtc://netquake.io/room'
	if (isRoom && !sys.state.initArgs.broker && !sys.state.initArgs.socket) {
		print('Can only join a room game from the room page.')
		return 'failed'
	}

	if (host.length <= 5)
		return 'failed'
	if (host.charCodeAt(6) === 47)
		return 'failed'

	state.currentRole = 'client'

	var sock = net.newQSocket();
	sock.disconnected = true;
	sock.receiveMessage = []
	sock.address = host;
	if (!isRoom) sock.protocol = 'nqnetchan'

	if (isRoom) {
		const injected = roomBroker()
		if (!injected) {
			print('WebRTC: no signaling broker was injected for this room.\n')
			return 'failed'
		}
		initBroker(injected)
	} else {
		const { brokerUrl, resource } = parseRtcUri(host)
		const broker = brokerUrl || cvr.broker.string
		try
		{
			websocket = new WebSocket(broker + '/FTE-Quake/' + resource, ['rtc_client'])
			websocket.binaryType = "arraybuffer";
		}
		catch (e)
		{
			debugger
			return 'failed'
		}
		initBroker(new FTEBroker(createSignaling(websocket)))
	}

	state.webRtcDriver = createDriver(sock)
	sock.driverdata = state.webRtcDriver
	net.state.newsocket = sock;
	
	state.broker.sendReady('0')

	return 'connected';
};

export const acceptNewConnection = async (identifier: string, iceServers?: RTCIceServer[], clientAddress?: string) => {
	const rtcPeer = new RTCPeerConnection({
		...defaultConfiguration,
		// Non Standard API config options
		// only for node-rtc
		iceServers: iceServers || []
	})

	rtcPeer.onicecandidate = (event) => {
		if(event.candidate && state.broker) {
			dbg(`[webrtc] sending candidate to ${identifier}:`, event.candidate.candidate)
			state.broker.sendCandidate(identifier, event.candidate)
		}
	}

	rtcPeer.oniceconnectionstatechange = () => {
		dbg(`[webrtc] ICE connection state (server, ${identifier}):`, rtcPeer.iceConnectionState)
	}

	rtcPeer.onicegatheringstatechange = () => {
		dbg(`[webrtc] ICE gathering state (server, ${identifier}):`, rtcPeer.iceGatheringState)
	}

	const driver: WebRTCDriver = {
		rtc: rtcPeer,
		channel: null,
		identifier,
		candidateCache: [],
		clientAddress: clientAddress
	}
	
	const channel = rtcPeer.createDataChannel('quake', { negotiated: true, id: 0 })
	driver.channel = channel

	state.webRtcClients[identifier] = driver
	state.acceptSockets.push(driver)
} 

const createDriver = (sock: ISocket) => {
	const rtcPeer = new RTCPeerConnection(
		defaultConfiguration
	)
	const channel = rtcPeer.createDataChannel('quake', { negotiated: true, id: 0 })
	channel.onmessage = (ev) => {
		sock.receiveMessage.push(ev.data)
	}
	
	channel.onclose = () => {
		print('WebRTC: Data channel closed')
		close(sock)
	}

	rtcPeer.onicecandidate = (event) => {
		if(event.candidate && state.broker) {
			dbg('[webrtc] sending candidate to server:', event.candidate.candidate)
			state.broker.sendCandidate(driver.identifier, event.candidate)
		}
	}

	rtcPeer.oniceconnectionstatechange = () => {
		dbg('[webrtc] ICE connection state (client):', rtcPeer.iceConnectionState)
	}

	rtcPeer.onicegatheringstatechange = () => {
		dbg('[webrtc] ICE gathering state (client):', rtcPeer.iceGatheringState)
	}

	const driver: WebRTCDriver = {
		rtc: rtcPeer,
		channel,
		identifier: '0',
		candidateCache: []
	}

	return driver
}

export const checkNewConnections = (): ISocket => {
	if (state.acceptSockets.length === 0)
		return;
	
	var sock = net.newQSocket();
	var driver = state.acceptSockets.shift();

	if (driver.channel) {
		print('SERVER - WebRTC: Data channel already open')
		driver.channel.onmessage = (ev) => { sock.receiveMessage.push(ev.data)}
		driver.channel.onclose = () => {
			close(sock)
		}
	} else {
		driver.rtc.ondatachannel = ({channel}) => {
			driver.channel = channel
			channel.onmessage = (ev) => {
				sock.receiveMessage.push(ev.data)
			}
			channel.onclose = () => {
				close(sock)
			}
		}
	}
	sock.driverdata = driver
	sock.receiveMessage = [];
	sock.address = driver.clientAddress || "unknown"

	return sock;
}

export const getMessage = function(sock: ISocket)
{
	if (sock.driverdata == null)
		return -1;

	// I had this line removed to fix something but broke the "Left" message. 
	// Not sure what that something was, but it works now.
	// if (sock.driverdata.channel.readyState !== 'open')
	// 	return -1;
	if (sock.receiveMessage.length === 0)
		return 0;
	
	var buffer = sock.receiveMessage.shift()
	var message = new Uint8Array(buffer)
	net.state.message.cursize = message.length;
	sz.u8(net.state.message).set(message);
	return 1;
};

export const sendMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock.driverdata == null || sock.driverdata.channel == null)
		return -1;
	if (sock.driverdata.channel.readyState !== 'open')
		return -1;
	var buf = new Uint8Array(data.data, 0, data.cursize).buffer.slice(0, data.cursize);
	sock.driverdata.channel.send(buf);
	return 1;
};

export const sendUnreliableMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock.driverdata == null || sock.driverdata.channel == null)
		return -1;
	if (sock.driverdata.channel.readyState !== 'open')
		return -1;
	var buf = new Uint8Array(data.data, 0, data.cursize).buffer.slice(0, data.cursize);
	sock.driverdata.channel.send(buf);
	return 1;
};

export const canSendMessage = function(sock: ISocket): boolean| undefined
{
	if (sock.driverdata == null || sock.driverdata.channel == null)
		return;
	if (sock.driverdata.channel.readyState === 'open')
		return true
};

export const close = function(sock: ISocket)
{
	if (sock.driverdata != null){
		const driver = sock.driverdata as WebRTCDriver
		if (driver.channel) {
			if (driver.channel.readyState === 'open') {
				driver.channel.close()
			}
			driver.channel.onmessage = null
			driver.channel = null
		}
		if (driver.rtc) {
			driver.rtc.ondatachannel = null
			driver.rtc.onicecandidate = null
			driver.rtc.close();
			delete driver.rtc
		}
	}

	if (state.currentRole === 'client' && state.broker) {
		state.broker.sendRemove(state.webRtcDriver?.identifier)
		state.broker.close()
		state.broker = null
	}
	sock.driverdata = null;
};

// Returns -1 if disconnected, 0 if connecting, and 1 if connected
export const checkForResend = function()
{
	const driver = net.state.newsocket.driverdata as WebRTCDriver
	const peerConnectionState = driver.rtc.connectionState
	if (peerConnectionState === 'connected') {
		// Channel is null while waiting for FTE to open it via ondatachannel
		if (driver.channel?.readyState === 'open') {
			return 1
		}
		return 0
	}
	if (peerConnectionState !== 'connecting' && peerConnectionState !== 'new')
		return -1;

	
};

export const registerWithMaster = () => {
	// Cannot connect to browser server, no peer to peer.
}

export const shutdown = () => {
	if (state.broker) {
		state.broker.sendRemove(state.webRtcDriver?.identifier || '0')
		state.broker.close()
		state.broker = null
	}
}