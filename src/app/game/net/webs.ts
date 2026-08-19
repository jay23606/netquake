import ISocket from '../../../engine/interfaces/net/ISocket'
import IDatagram from '../../../engine/interfaces/net/IDatagram'
import * as net from '../../../engine/net'
import * as sz from '../../../engine/sz'
import * as def from '../../../engine/def'
import { QConnectStatus } from '../../../engine/interfaces/net/INetworkDriver'

export const name: string = "websocket"
export var initialized: boolean = false;
export var available: boolean = false;

export const supportedAddress = (connectionAddress: string) => {
	return connectionAddress.substring(0, 5) === 'ws://' || connectionAddress.substring(0, 6) === 'wss://'
}

export const init = () => { 
	if(typeof window === "undefined")
		return
	if (window['WebSocket'] == null)
		return;
	available = true
	initialized = true
	return true;
};

export const listen = () => {}
export const connect = async (host: string): Promise<QConnectStatus> =>
{
	if (host.length <= 5)
		return 'failed'
	if (host.charCodeAt(6) === 47)
		return 'failed'
	if (host.substring(0, 6) !== 'wss://' && host.substring(0, 5) !== 'ws://')
		return 'failed'
	var sock = net.newQSocket();
	sock.disconnected = true;
	sock.receiveMessage = []
	sock.address = host;
	sock.canSend = true
	sock.protocol = 'nqnetchan'
	try
	{
		sock.driverdata = new WebSocket(host, 'fteqw');
	}
	catch (e)
	{
		return 'failed';
	}
	sock.driverdata.data_socket = sock;
	sock.driverdata.binaryType = 'arraybuffer';
	sock.driverdata.onerror = onError;
	sock.driverdata.onmessage = onMessage;
	net.state.newsocket = sock;
	
	return 'connected';
};

export const checkNewConnections = (): ISocket => {
	return null
}


// for debug only
// const printAscii = (dec: number) => {
// 	if (dec && dec > 31 && dec < 126) {
// 		return ' ' + String.fromCharCode(dec).padStart(2, ' ')
// 	} else {
// 		return ' 0x' + dec.toString(16).padStart(2, '0')
// 	}
// }
// export const byteArayToString = (bytes: ArrayBuffer) => {
// 	if (bytes[0] === 1) {
// 		return [].map.call(bytes.slice(0, 200), printAscii)
// 	} else {
// 		return [].map.call(bytes.slice(0, 200), x => x.toString(16))
// 	}
// }

export const getMessage = function(sock: ISocket)
{
	if (sock.driverdata == null)
		return -1;
	if (sock.driverdata.readyState !== 1)
		return -1;

	if (sock.receiveMessage.length === 0)
		return 0;

	var buffer = sock.receiveMessage.shift();
	var message = new Uint8Array(buffer);
	net.state.message.cursize = message.length;
	sz.u8(net.state.message).set(message);
	return 1;
};

export const sendMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock.driverdata == null)
		return -1;
	if (sock.driverdata.readyState !== 1)
		return -1;

	var buf = new Uint8Array(data.data, 0, data.cursize).buffer.slice(0, data.cursize);
	sock.driverdata.send(buf);
	return 1;
};

export const sendUnreliableMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock.driverdata == null)
		return -1;
	if (sock.driverdata.readyState !== 1)
		return -1;
	var buf = new Uint8Array(data.data, 0, data.cursize).buffer.slice(0, data.cursize);
	sock.driverdata.send(buf);
	return 1;
};

export const canSendMessage = function(sock: ISocket)
{
	if (sock.driverdata == null)
		return;
	if (sock.driverdata.readyState === 1)
		return true;
};

export const close = function(sock: ISocket)
{
	if (sock.driverdata != null)
		sock.driverdata.close(1000);
};

export const checkForResend = function()
{
	if (net.state.newsocket.driverdata.readyState === 1)
		return 1;
	if (net.state.newsocket.driverdata.readyState !== 0)
		return -1;
};

export const onError = function()
{
	net.close(this.data_socket);
};

export const registerWithMaster = () => {
	// Cannot connect to browser server, no peer to peer.
}

export const onMessage = function(message: MessageEvent)
{
	var data = message.data;
	if (typeof(data) === 'string')
		return;
	if (data.byteLength > def.max_message)
		return;
	this.data_socket.receiveMessage.push(data);
};