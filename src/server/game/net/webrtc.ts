import {connection, client} from 'websocket'
import ISocket from '../../../engine/interfaces/net/ISocket'
import IDatagram from '../../../engine/interfaces/net/IDatagram'
import * as sv from '../../../engine/sv'
import * as net from '../../../engine/net'
import * as sz from '../../../engine/sz'
import * as wrtc from '@roamhq/wrtc'
import {FTEBroker} from '../../../shared/webrtc/FTEBroker'
import { QConnectStatus } from '../../../engine/interfaces/net/INetworkDriver'
import { print } from '../sys'
import { CVars } from '../../../engine/cvar'
import * as cvar from '../../../engine/cvar'
import { Signaling } from '../../../shared/webrtc/signaling'

export const name = "webrtc"
export var initialized = false
export var available = true

export const cvr:CVars = {

}

// for debug only
const printAscii = (dec: number) => {
	if (dec && dec > 31 && dec < 126) {
		return ' ' + String.fromCharCode(dec).padStart(2, ' ')
	} else {
		return ' 0x' + dec.toString(16).padStart(2, '0')
	}
}
export const byteArayToString = (bytes: Uint8Array) => {
	if (bytes[0] === 1) {
		return [].map.call(bytes.slice(0, 200), printAscii)
	} else {
		return [].map.call(bytes.slice(0, 200), (x: any) => x.toString(16))
	}
}

export const defaultConfiguration: RTCConfiguration = { 
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302"
      ]
    }
  ], 
  iceTransportPolicy: 'all', 
  bundlePolicy: 'balanced', 
  rtcpMuxPolicy: 'require', 
  iceCandidatePoolSize: 0
}

export type WebRTCDriver = {
  rtc: RTCPeerConnection
  channel: RTCDataChannel,
  clientId: string
}

export type SignalingConnection = connection & {data_socket?: ISocket}

export type WebRTCState = {
  broker: FTEBroker | null,
  acceptSockets: WebRTCDriver[],
  webRtcClients: Record<string, WebRTCDriver>
}

export const state: WebRTCState = {
  broker: null,
  acceptSockets: [],
  webRtcClients: {}
}

// not implemented client specific functions
export const connect = async (host: string): Promise<QConnectStatus> => {
  return 'failed'
}
export const checkForResend = (): number => {
  return 0
}

export const supportedAddress = (connectionAddress: string) =>  true

export const acceptNewConnection = async (clientId: string) => {
  const rtcPeer = new wrtc.RTCPeerConnection({
    ...defaultConfiguration,
    // Non Standard API config options
    // only for node-rtc
    sdpSemantics: 'unified-plan',
    // portRange: {
    //   min: 10000,
    //   max: 20000,
    // }
  } as any)

  rtcPeer.onicecandidate = (event) => {
    if(event.candidate && state.broker) {
      state.broker.sendCandidate(clientId, event.candidate)
    }
  }

  const driver: WebRTCDriver = {
    rtc: rtcPeer,
    channel: null,  
    clientId,
  }

  state.webRtcClients[clientId] = driver
  state.acceptSockets.push(driver)
} 



export const init = function()
{
  cvr.net_ice_broker = cvar.registerVariable('net_ice_broker', 'wss://master.quakeone.com:27950')

  const ws = new client()
  ws.connect(cvr.net_ice_broker.string + '/FTE-Quake/' + net.cvr.hostname.string, 'rtc_host')
  //ws.connect('ws://localhost:8080', 'rtc_host')
  ws.on('connect', (connection) => {
    state.broker = new FTEBroker(createSignaling(connection))
    state.broker.on('greeting', ({gameName}) => {
      print(`WebRTC: Connected to broker for ${gameName}\n`)
    })
    
    state.broker.on('peerLost', ({clientId}) => {
      if (state.webRtcClients[clientId])
        delete state.webRtcClients[clientId]
    })
    state.broker.on('newPeer', ({clientId}) => {
      acceptNewConnection(clientId)
    })
    state.broker.on('offer', async ({clientId, offerOrAnswer}) => {
      const driver = state.webRtcClients[clientId]
      if (!driver) {
        print(`WebRTC: Could not find client for ${clientId}\n`)
        return
      }

      await driver.rtc.setRemoteDescription(offerOrAnswer)
      const answer = await driver.rtc.createAnswer()
      await driver.rtc.setLocalDescription(answer)
      
      state.broker.sendOffer(clientId, answer)
    })
    state.broker.on('candidate', async ({clientId, candidate}) => {
      if (!candidate || !candidate.candidate) return
      const driver = state.webRtcClients[clientId]
      if (!driver) {
        print(`WebRTC: Could not find client for ${clientId}\n`)
        return
      }
      try {
        await driver.rtc.addIceCandidate(candidate)
      } catch(e) {
        console.log('WebRTC: Failed to add ice candidate', e)
      }
    })
  })

  this.initialized = true
  return true
}


// Listening is performed by webs and passes control to here.
export const listen = function() { 
}

export const registerWithMaster = () => {
}


const createSignaling = (webSocket: connection): Signaling => ( {
  send: (data: Uint8Array | string) => {
    if (typeof data === 'string') {
      webSocket.send(data)
    } else {
      webSocket.send(Buffer.from(data))
    }
  },
  onmessage: (callback: (data: Buffer | string) => void) => {
    webSocket.on('message', (event) => {
      if (event.type === 'utf8') {
        callback(event.utf8Data)
        return
      }
      callback(event.binaryData)
    })
  },
  close: () => {
    webSocket.close()
  }
})

export const close = (sock: ISocket) => {
	if (sock.driverdata == null)
		return;
  sock.driverdata.rtc.close()
  sock.driverdata = null
}

// const createDriver = (socket: ISocket, signaling: SignalingConnection) => {
//   const driver = {
//     rtc: new WebRTC(
//       new wrtc.RTCPeerConnection({
//       } as any),
//       createSignaling(signaling),
//       false,
//     ),
//     signaling
//   }

//   driver.rtc.onReceive((bytes: ArrayBuffer) => {
//     socket.receiveMessage.push(bytes)
//   })

//   return driver
// }

export const checkNewConnections = () => {
	if (state.acceptSockets.length === 0)
		return;

  console.log('New Peer connection...');
  
	var sock = net.newQSocket();
	var driver = state.acceptSockets.shift();

  driver.rtc.ondatachannel = ({channel}) => {
    driver.channel = channel
    channel.onmessage = (ev) => {
      sock.receiveMessage.push(ev.data)
    }
  }

	sock.driverdata = driver
	sock.receiveMessage = [];
	sock.address = "REMOTEADDRESS-TODO"

  return sock;
};

export const getMessage = (sock: ISocket) => {
	if (sock.driverdata == null)
		return -1;

  // TODO: JOe - why is this being checked?
  // if (sock.driverdata.rtc.connectionState() === 'closed')
  //   return -1;

	if (sock.receiveMessage.length === 0)
		return 0;
 
	// var src = sock.receiveMessage.shift(), dest = new Uint8Array(net.state.message.data);
	// net.state.message.cursize = src.length - 1;
	// var i;
	// for (i = 1; i < src.length; ++i)
	// 	dest[i - 1] = src[i];
	// return src[0];

	var buffer = sock.receiveMessage.shift()
	var message = new Uint8Array(buffer, 1, buffer.byteLength - 1)
  // console.log(byteArayToString(message))
	net.state.message.cursize = message.length;
	sz.u8(net.state.message).set(message);
	return message[0];
}

export const sendMessage = (sock: ISocket, data: IDatagram) => {
	if (sock.driverdata == null)
		return -1;

  const driver = sock.driverdata as WebRTCDriver
  if (!canSendMessage(sock))
		return -1;

	var src = new Uint8Array(data.data), dest = Buffer.alloc(data.cursize + 1), i;
	dest[0] = 1;
	var i;
	for (i = 0; i < data.cursize; ++i)
		dest[i + 1] = src[i];

	driver.channel.send(dest);

	return 1;
}

export const sendUnreliableMessage = (sock: ISocket, data: IDatagram) => {
	if (sock.driverdata == null)
		return -1;
  if (!canSendMessage(sock))
		return -1;
  const driver = sock.driverdata as WebRTCDriver
	var src = new Uint8Array(data.data), dest = Buffer.alloc(data.cursize + 1), i;
	dest[0] = 2;
	var i;
	for (i = 0; i < data.cursize; ++i)
		dest[i + 1] = src[i];

	driver.channel.send(dest);

	return 1;
};

export const canSendMessage = (sock: ISocket) => {
  const driver = sock.driverdata as WebRTCDriver
  return driver.channel &&
    driver.channel.readyState === 'open'
};

