import ISocket from '../../../engine/interfaces/net/ISocket'
import IDatagram from '../../../engine/interfaces/net/IDatagram'
import * as sv from '../../../engine/sv'
import * as net from '../../../engine/net'
import * as sz from '../../../engine/sz'
import * as def from '../../../engine/def'
import * as websocket from 'websocket'
import * as httpServer from './http'
import { QConnectStatus } from '../../../engine/interfaces/net/INetworkDriver'
import { Server } from 'http'

const NETFLAG_CTL = 0x80000000
const CCREQ_CONNECT = 0x01
const CCREP_ACCEPT = 0x81

export const name = "websocket"
export var initialized = false
export var available = true
type WebSocketState = {
	server: websocket.server,
	http: Server,
	acceptsockets: (websocket.connection & {data_socket?: ISocket})[] ,
	colors: string[]
}
export const state: WebSocketState = {
  server: null,
  http: null,
  acceptsockets: [],
  colors: []
}

// not implemented client specific functions
export const connect = async (host: string): Promise<QConnectStatus> => {
  return 'failed'
}
export const checkForResend = (): number => {
  return 0
}

export const supportedAddress = (connectionAddress: string) => {
	return connectionAddress.substring(0, 5) === 'ws://' || connectionAddress.substring(0, 6) === 'wss://'
}

export const init = function()
{
	state.server = new websocket.server;
	state.server.on('request', serverOnRequest);

	initialized = true

	return true;
};

export const listen = function()
{
	if (net.state.listening !== true)
	{
		state.server.unmount();
		if (state.http == null)
			return;
		state.http.close();
		state.http = null;
		return;
	}
	try
	{
    	state.http = httpServer.createHttpServer(net.state.hostport)
		state.server.mount({httpServer: state.http, maxReceivedMessageSize: def.max_message});
	}
	catch (e)
	{
		net.state.listening = false;
		return;
	}
};

export const registerWithMaster = () => {
}

export const checkNewConnections = (): ISocket => {
	if (state.acceptsockets.length === 0)
		return;
	var sock = net.newQSocket();
	var connection = state.acceptsockets.shift();
	sock.driverdata = connection;
	sock.receiveMessage = [];
	sock.address = connection.socket.remoteAddress;
	sock.protocol = 'nqnetchan'
	sock.canSend = true
	connection.data_socket = sock;
	connection.on('message', connectionOnMessage);
	connection.on('close', connectionOnClose);

	return sock;
};

export const getMessage = (sock: ISocket) => {
	if (sock.driverdata == null)
		return -1;
	if (sock.driverdata.closeReasonCode !== -1)
		return -1;
	if (sock.receiveMessage.length === 0)
		return 0;
	var src = sock.receiveMessage.shift();
	var dest = sz.u8(net.state.message);
	net.state.message.cursize = src.length;
	for (var i = 0; i < src.length; ++i)
		dest[i] = src[i];
	return 1;
}

export const sendMessage = (sock: ISocket, data: IDatagram) => {
	if (sock.driverdata == null)
		return -1;
	if (sock.driverdata.closeReasonCode !== -1)
		return -1;
	var src = new Uint8Array(data.data);
	var dest = Buffer.alloc(data.cursize);
	for (var i = 0; i < data.cursize; ++i)
		dest[i] = src[i];
	sock.driverdata.sendBytes(dest);
	return 1;
}

export const sendUnreliableMessage = (sock: ISocket, data: IDatagram) => {
	if (sock.driverdata == null)
		return -1;
	if (sock.driverdata.closeReasonCode !== -1)
		return -1;
	var src = new Uint8Array(data.data);
	var dest = Buffer.alloc(data.cursize);
	for (var i = 0; i < data.cursize; ++i)
		dest[i] = src[i];
	sock.driverdata.sendBytes(dest);
	return 1;
};

export const canSendMessage = (sock: ISocket) => {
	if (sock.driverdata == null)
		return;
	if (sock.driverdata.closeReasonCode === -1)
		return true;
};

export const close = (sock: ISocket) => {
	if (sock.driverdata == null)
		return;
	if (sock.driverdata.closeReasonCode !== -1)
		return;
	sock.driverdata.drop(1000);
	sock.driverdata = null;
};

const connectionOnMessage = function(message: websocket.Message)
{
	if (message.type !== 'binary')
		return;
	if (message.binaryData.length > def.max_message)
		return;
	this.data_socket.receiveMessage.push(message.binaryData);
};

const connectionOnClose = function()
{
	net.close(this.data_socket);
};


const serverOnRequest = (request: websocket.request) => {
	if (sv.state.server.phase !== 'active')
	{
		request.reject();
		return;
	}
	if ((net.state.activeconnections + state.acceptsockets.length) >= sv.state.svs.maxclients)
	{
		request.reject();
		return;
	}
	if (!request.requestedProtocols.includes('fteqw'))
	{
		request.reject();
		return;
	}
	var connection = request.accept('fteqw', request.origin);
	var onCCREQ = (message: websocket.Message) => {
		if (message.type !== 'binary') return;
		var data = message.binaryData;
		if (data.length < 5) return;
		var header = data.readUInt32BE(0);
		if (!(header & NETFLAG_CTL)) return;
		if (data[4] !== CCREQ_CONNECT) return;

		// Send CCREP_ACCEPT
		var resp = Buffer.alloc(9);
		resp.writeUInt32BE((NETFLAG_CTL | 9) >>> 0, 0);
		resp[4] = CCREP_ACCEPT;
		resp.writeUInt32BE(0, 5); // port = 0
		connection.sendBytes(resp);
		connection.removeListener('message', onCCREQ);
		state.acceptsockets.push(connection);
	};
	connection.on('message', onCCREQ);
	connection.on('close', () => {
		connection.removeListener('message', onCCREQ);
	});
};
