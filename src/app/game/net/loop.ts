import * as sys from '../sys'
import * as def from '../../../engine/def'
import * as net from '../../../engine/net'
import * as sz from '../../../engine/sz'
import ISocket from '../../../engine/interfaces/net/ISocket'
import IDatagram from '../../../engine/interfaces/net/IDatagram'
import { QConnectStatus } from '../../../engine/interfaces/net/INetworkDriver'

export const name: string = "loop"
export var initialized: boolean = false;
export var available: boolean = true;

export type LoopState = {
	client: ISocket | null,
	server: ISocket | null,
	localconnectpending: boolean
}
export const state: LoopState = {
  client: null,
  server: null,
	localconnectpending: false
}

export const supportedAddress = (connectionAddress: string) => { 
	return connectionAddress === 'local'
}
export const init = () => {
	
	initialized = true
	return true;
};

export const listen = () => {

}

export const registerWithMaster = () => {
}

export const connect = async (host: string): Promise<QConnectStatus | ISocket> => {
	if (host !== 'local')
		return 'failed';

	state.localconnectpending = true;

	if (state.client == null)
	{
		state.client = net.newQSocket();
		state.client.receiveMessage = new Uint8Array(new ArrayBuffer(def.max_message));
		state.client.address = 'localhost';
	}
	state.client.receiveMessageLength = 0;
	state.client.canSend = true;

	if (state.server == null)
	{
		state.server = net.newQSocket();
		state.server.receiveMessage = new Uint8Array(new ArrayBuffer(def.max_message));
		state.server.address = 'LOCAL';
	}
	state.server.receiveMessageLength = 0;
	state.server.canSend = true;

	state.client.driverdata = state.server;
	state.server.driverdata = state.client;

	return state.client;
};

export const checkNewConnections = function()
{
	if (state.server === null || state.client === null || state.localconnectpending !== true)
		return;
	state.localconnectpending = false;
	state.server.receiveMessageLength = 0;
	state.server.canSend = true;
	state.client.receiveMessageLength = 0;
	state.client.canSend = true;
	return state.server;
};

// Queue entry framing: [type][len0][len1][len2] + payload. The length is 3 bytes —
// vanilla's 2-byte header silently wraps any message over 64KB (large-map signons
// with hundreds of statics exceed that), truncating the stream mid-svc.
export const getMessage = function(sock: ISocket)
{
	if (sock.receiveMessageLength === 0)
		return 0;
	var ret = sock.receiveMessage[0];
	var length = sock.receiveMessage[1] + (sock.receiveMessage[2] << 8) + (sock.receiveMessage[3] << 16);
	if (length > net.state.message.data.byteLength)
		sys.error('Loop.GetMessage: overflow');
	net.state.message.cursize = length;
	sz.u8(net.state.message).set(sock.receiveMessage.subarray(4, length + 4));
	sock.receiveMessageLength -= length;
	if (sock.receiveMessageLength >= 5)
	{
		for (var i = 0; i < sock.receiveMessageLength; ++i)
			sock.receiveMessage[i] = sock.receiveMessage[length + 4 + i];
	}
	sock.receiveMessageLength -= 4;
	if ((sock.driverdata != null) && (ret === 1))
		sock.driverdata.canSend = true;
	return ret;
};

export const sendMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock.driverdata == null)
		return -1;
	var bufferLength = sock.driverdata.receiveMessageLength;
	sock.driverdata.receiveMessageLength += data.cursize + 4;
	if (sock.driverdata.receiveMessageLength > def.max_message)
		sys.error('Loop.SendMessage: overflow');
	var buffer = sock.driverdata.receiveMessage;
	buffer[bufferLength] = 1;
	buffer[bufferLength + 1] = data.cursize & 0xff;
	buffer[bufferLength + 2] = (data.cursize >> 8) & 0xff;
	buffer[bufferLength + 3] = (data.cursize >> 16) & 0xff;
	buffer.set(sz.u8(data).subarray(0, data.cursize), bufferLength + 4);
	sock.canSend = false;
	return 1;
};

export const sendUnreliableMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock.driverdata == null)
		return -1;
	var bufferLength = sock.driverdata.receiveMessageLength;
	sock.driverdata.receiveMessageLength += data.cursize + 4;
	if (sock.driverdata.receiveMessageLength > def.max_message)
		sys.error('Loop.SendMessage: overflow');
	var buffer = sock.driverdata.receiveMessage;
	buffer[bufferLength] = 2;
	buffer[bufferLength + 1] = data.cursize & 0xff;
	buffer[bufferLength + 2] = (data.cursize >> 8) & 0xff;
	buffer[bufferLength + 3] = (data.cursize >> 16) & 0xff;
	buffer.set(sz.u8(data).subarray(0, data.cursize), bufferLength + 4);
	return 1;
};

export const canSendMessage = function(sock: ISocket)
{
	if (sock.driverdata != null)
		return sock.canSend;
};

export const close = function(sock: ISocket)
{
	if (sock.driverdata != null)
		sock.driverdata.driverdata = null;
	sock.receiveMessageLength = 0;
	sock.canSend = false;
	if (sock === state.client)
		state.client = null;
	else
		state.server = null;
};

export const checkForResend = function()
{
	if (net.state.newsocket.driverdata.readyState === 1)
		return 1;
	if (net.state.newsocket.driverdata.readyState !== 0)
		return -1;
};
