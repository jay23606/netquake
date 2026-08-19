import ISocket from '../../../engine/interfaces/net/ISocket'
import IDatagram from '../../../engine/interfaces/net/IDatagram'
import * as sv from '../../../engine/sv'
import * as pr from '../../../engine/pr'
import * as com from '../../../engine/com'
import * as con from '../../../engine/console'
import * as net from '../../../engine/net'
import * as sz from '../../../engine/sz'
import * as def from '../../../engine/def'
import * as cvar from '../../../engine/cvar'
import * as sys from '../sys'
import * as dgram from 'dgram'
import * as os from 'os'
import * as dpmaster from './dpmaster'
import { QConnectStatus } from '../../../engine/interfaces/net/INetworkDriver'

const HEADER_SIZE = 8
type RInfo = {
	address: string // The sender address.
	family: string //  The address family ('IPv4' or 'IPv6').
	port: number // The sender port.
	size: number // The message size.
}

type AcceptSockets = {
	address: string // The sender address.
	port: number // The sender port.
	mod: {
		type: number
		version: number
		flags: number
	}
}

const printAscii = (dec: number) => {
	if (dec && dec > 31 && dec < 126) {
		return ' ' + String.fromCharCode(dec).padStart(2, ' ')
	} else {
		return ' 0x' + dec.toString(16).padStart(2, '0')
	}
}

export const byteArayToString = (bytes: ArrayBuffer) => {
	return [].map.call(bytes.slice(0, 200), printAscii)
}

export const name = "datagram"
export var initialized = false
export var available = true

export type DatagramState = {
	sockets: Record<string, ISocket>
	acceptsockets: AcceptSockets[]
	myAddr: string
	controlsocket: dgram.Socket | null
}

export const state: DatagramState = {
  sockets: {},
  acceptsockets: [],
  myAddr: null,
  controlsocket: null
}

// not implemented client specific functions
export const connect = async (host: string): Promise<QConnectStatus> => {
  return 'failed'
}
export const checkForResend = (): number => {
  return 0
}

export const registerWithMaster = () => {
	dpmaster.triggerHeartbeat()
}
export const supportedAddress = (connectionAddress: string) => true

export const init = function()
{
	if (com.checkParm('-noudp') != null)
		return;

	let i

	var local = os.networkInterfaces(), j, k, addr;
	for (i in local)
	{
		j = local[i];
		for (k = 0; k < j.length; ++k)
		{
			addr = j[k];
			if ((addr.family !== 'IPv4') || (addr.internal === true))
				continue;
			state.myAddr = addr.address;
			break;
		}
		if (state.myAddr != null)
			break;
	}
	if (state.myAddr == null)
		state.myAddr = '127.0.0.1';

	dpmaster.init()
	initialized = true
	return true;
};

export const listen = function()
{
	if (net.state.listening !== true)
	{
		if (state.controlsocket == null)
			return;
		state.controlsocket.close();
		state.controlsocket = null;
		return;
	}
	var controlsocket = dgram.createSocket('udp4');
	try
	{
		controlsocket.bind(net.state.hostport);
	}
	catch (e)
	{
		con.print('Unable to bind to ' + state.myAddr + ':' + net.state.hostport + '\n');
		controlsocket.close();
		return;
	}
	controlsocket.on('message', onMessage);
	state.controlsocket = controlsocket;
};

export const checkNewConnections = function()
{
	dpmaster.checkHeartbeat(state.controlsocket)

	if (state.acceptsockets.length === 0)
		return;
	var sock = net.newQSocket();
	var acceptData = state.acceptsockets.shift();
	sock.lastSendTime = net.state.time;
	sock.canSend = true;
	sock.driverdata = state.controlsocket;
	sock.ackSequence = 0;
	sock.sendSequence = 0;
	sock.unreliableSendSequence = 0;
	sock.sendMessageLength = 0;
	sock.sendMessage = Buffer.alloc(def.max_message);
	sock.receiveSequence = 0;
	sock.unreliableReceiveSequence = 0;
	sock.receiveMessageLength = 0;
	sock.receiveMessage = Buffer.alloc(def.max_message);
	sock.addr = [acceptData.address, acceptData.port],
	sock.address = acceptData.address + ':' + acceptData.port
	sock.messages = [];
	state.sockets[sock.address] = sock
	var buf = Buffer.alloc(def.max_message + HEADER_SIZE);
	buf.writeUInt32LE(0x09000080, 0);
	buf[4] = 0x81;
	buf.writeUInt32LE(net.state.hostport, 5);
	state.controlsocket.send(buf, 0, 9, acceptData.port, acceptData.address);
	return sock;
};

export const getMessage = function(sock: ISocket)
{
	if (sock.driverdata == null)
		return -1;
	if ((sock.canSend !== true) && ((net.state.time - sock.lastSendTime) > 1.0)){
		sendMessageNext(sock, true);
	}
	var message, length, flags, ret = 0, sequence, i;
	for (; sock.messages.length > 0; )	
	{
		message = sock.messages.shift();
		length = (message[2] << 8) + message[3] - 8;
		flags = message[1];
		sequence = message.readUInt32BE(4);

		if ((flags & 16) !== 0)
		{
			if (sequence < sock.unreliableReceiveSequence)
			{
				con.dPrint('Got a stale datagram\n');
				ret = 0;
				break;
			}
			if (sequence !== sock.unreliableReceiveSequence)
        		con.dPrint('Dropped ' + (sequence - sock.unreliableReceiveSequence) + ' datagram(s)\n');
			sock.unreliableReceiveSequence = sequence + 1;
			const dest = sz.u8(net.state.message)
			net.state.message.cursize = length;
			for (i = 0; i < length; ++i)
				dest[i] = message[8 + i];
			ret = 2;
			break;
		}
		if ((flags & 2) !== 0)
		{
			if (sequence !== (sock.sendSequence - 1))
			{
				con.dPrint('Stale ACK received\n');
				continue;
			}
			if (sequence === sock.ackSequence)
			{
				if (++sock.ackSequence !== sock.sendSequence)
          			con.dPrint('ack sequencing error\n');
			}
			else
			{
				con.dPrint('Duplicate ACK received\n');
				continue;
			}
			sock.sendMessageLength -= def.max_message;
			if (sock.sendMessageLength > 0)
			{
				sock.sendMessage.copy(sock.sendMessage, 0, def.max_message, def.max_message + sock.sendMessageLength);
				sock.sendNext = true;
				continue;
			}
			sock.sendMessageLength = 0;
			sock.canSend = true;
			continue;
		}
		if ((flags & 1) !== 0)
		{
			sock.driverdata.send(Buffer.from([0, 2, 0, 8, sequence >>> 24, (sequence & 0xff0000) >>> 16, (sequence & 0xff00) >>> 8, (sequence & 0xff) >>> 0]),
				0, 8, sock.addr[1], sock.addr[0]);
			if (sequence !== sock.receiveSequence)
				continue;
			++sock.receiveSequence;
			if ((flags & 8) === 0)
			{
				message.copy(sock.receiveMessage, sock.receiveMessageLength, 8, 8 + length);
				sock.receiveMessageLength += length;
				continue;
			}
			var data = sz.u8(net.state.message);
			for (i = 0; i < sock.receiveMessageLength; ++i)
				data[i] = sock.receiveMessage[i];
			for (i = 0; i < length; ++i)
				data[sock.receiveMessageLength + i] = message[8 + i];
			net.state.message.cursize = sock.receiveMessageLength + length;

			sock.receiveMessageLength = 0;
			ret = 1;
			break;
		}
	}
	if (sock.sendNext === true)
		sendMessageNext(sock, false);
	return ret;
};

export const sendMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock.driverdata == null)
		return -1;
	var i, src = new Uint8Array(data.data);
	for (i = 0; i < data.cursize; ++i)
		sock.sendMessage[i] = src[i];
	sock.sendMessageLength = data.cursize;
	var buf = Buffer.alloc(def.max_message + HEADER_SIZE);
	buf[0] = 0;
	var dataLen;
	if (data.cursize <= def.max_message)
	{
		dataLen = data.cursize;
		buf[1] = 9;
	}
	else
	{
		dataLen = def.max_message;
		buf[1] = 1;
	}
	buf.writeUInt16BE(dataLen + 8, 2);
	buf.writeUInt32BE(sock.sendSequence++, 4);
	sock.sendMessage.copy(buf, 8, 0, dataLen);
	sock.canSend = false;
	sock.driverdata.send(buf, 0, dataLen + 8, sock.addr[1], sock.addr[0]);
	sock.lastSendTime = net.state.time;
	
	return 1;
};

const sendMessageNext = function(sock: ISocket, resend: boolean)
{
	var buf = Buffer.alloc(def.max_message + HEADER_SIZE);
	buf[0] = 0;
	var dataLen;
	if (sock.sendMessageLength <= def.max_message)
	{
		dataLen = sock.sendMessageLength;
		buf[1] = 9;
	}
	else
	{
		dataLen = def.max_message;
		buf[1] = 1;
	}
	buf.writeUInt16BE(dataLen + 8, 2);
	if (resend !== true)
		buf.writeUInt32BE(sock.sendSequence++, 4);
	else
		buf.writeUInt32BE(sock.sendSequence - 1, 4);
	sock.sendMessage.copy(buf, 8, 0, dataLen);
	sock.sendNext = false;
	sock.driverdata.send(buf, 0, dataLen + 8, sock.addr[1], sock.addr[0]);
	sock.lastSendTime = net.state.time;
};

export const sendUnreliableMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock.driverdata == null)
		return -1;
	var buf = Buffer.alloc(def.max_message + HEADER_SIZE);
	buf.writeUInt32BE(data.cursize + 0x00100008, 0);
	buf.writeUInt32BE(sock.unreliableSendSequence++, 4);
	var i, src = new Uint8Array(data.data);
	for (i = 0; i < data.cursize; ++i)
		buf[8 + i] = src[i];
	
	sock.driverdata.send(buf, 0, data.cursize + 8, sock.addr[1], sock.addr[0]);
	return 1;
};

export const canSendMessage = function(sock: ISocket)
{
	if (sock.driverdata == null)
		return;
	if (sock.sendNext === true)
		sendMessageNext(sock, false);
	return sock.canSend;
};

export const close = function(sock: ISocket)
{
	if (sock.driverdata == null)
		return;
	
	delete state.sockets[sock.address]
	sock.driverdata = null;
};

const onMessage = function(msg: Buffer, rinfo: RInfo)
{
	const sockets = state.sockets
	if (sv.state.server.phase !== 'active')
		return;

	// Handle dpmaster connectionless packets (0xFFFFFFFF header)
	if (rinfo.size >= 5 && msg[0] === 0xFF && msg[1] === 0xFF && msg[2] === 0xFF && msg[3] === 0xFF) {
		dpmaster.handleConnectionlessPacket(state.controlsocket, msg, rinfo)
		return
	}

	const address = rinfo.address +':'+ rinfo.port
	if (sockets[address] && rinfo.size >= 8) {
		if ((msg[0] & 0x80) !== 0)
			return;
		const sock = sockets[address]
		sock.messages.push(msg)
		return
	}

	if (rinfo.size < 4)
		return;
	if ((msg[0] !== 0x80) || (msg[1] !== 0))
		return;
	if (((msg[2] << 8) + msg[3]) !== rinfo.size)
		return;``
	var command = msg[4];
	var buf = Buffer.alloc(def.max_message + HEADER_SIZE), str, cursize;
	buf[0] = 0x80;
	buf[1] = 0;

	if (command === 2) // CCREQ_SERVER_INFO
	{
		if (msg.toString('ascii', 5, 11) !== 'QUAKE\0')
			return;
		buf[4] = 0x83;
		str = state.myAddr + ':' + net.state.hostport;
		buf.write(str, 5, str.length, 'ascii');
		cursize = str.length + 5;
		buf[cursize++] = 0;
		str = net.cvr.hostname.string;
		buf.write(str, cursize, str.length, 'ascii');
		cursize += str.length;
		buf[cursize++] = 0;
		str =  pr.getString(pr.state.globals_int[pr.globalvars.mapname]);
		buf.write(str, cursize, str.length, 'ascii');
		cursize += str.length;
		buf[cursize++] = 0;
		buf[cursize++] = net.state.activeconnections;
		buf[cursize++] = sv.state.svs.maxclients;
		buf[cursize++] = 3;
		buf[2] = cursize >> 8;
		buf[3] = cursize & 255;
		state.controlsocket.send(buf, 0, cursize, rinfo.port, rinfo.address);
		return;
	}

	var i;

	if (command === 3) // CCREQ_PLAYER_INFO
	{
		var playerNumber = msg[5];
		if (playerNumber == null)
			return;
		var activeNumber = -1, client;
		for (i = 0; i < sv.state.svs.maxclients; ++i)
		{
			client = sv.state.svs.clients[i];
			if (client.active !== true)
				continue;
			if (++activeNumber === playerNumber)
				break;
		}
		if (i === sv.state.svs.maxclients)
			return;
		buf[4] = 0x84;
		buf[5] = playerNumber;
		str = sv.getClientName(client);
		buf.write(str, 6, str.length, 'ascii');
		cursize = str.length + 6;
		buf[cursize++] = 0;
		buf.writeUInt32LE(client.colors, cursize);
		buf.writeInt32LE(client.edict.v_float[pr.entvars.frags] >> 0, cursize + 4);
		buf.writeInt32LE((sys.floatTime() - client.netconnection.connecttime) >> 0, cursize + 8);
		cursize += 12;
		str = client.netconnection.address;
		buf.write(str, cursize, str.length, 'ascii');
		cursize += str.length;
		buf[cursize++] = 0;
		buf[2] = cursize >> 8;
		buf[3] = cursize & 255;
		state.controlsocket.send(buf, 0, cursize, rinfo.port, rinfo.address);
		return;
	}

	if (command === 4) // CCREQ_RULE_INFO
	{
		var cvarBytes = []
		for (i  = 5; i < msg.length && msg[i] !== 0; i++)
			cvarBytes.push(String.fromCharCode(msg[i]))
		var prevCvarName = cvarBytes.join('')
		if (prevCvarName.length !== 0)
		{
			for (i = 0; i < cvar.vars.length; ++i)
			{
				if (cvar.vars[i].name === prevCvarName)
					break;
			}
			if (i === cvar.vars.length)
				return;
			++i;
		}
		else
			i = 0;
		var v;
		for (; i < cvar.vars.length; ++i)
		{
			v = cvar.vars[i];
			if (v.server === true)
				break;
		}
		buf[4] = 0x85;
		if (i >= cvar.vars.length)
		{
			buf[2] = 0;
			buf[3] = 5;
			state.controlsocket.send(buf, 0, 5, rinfo.port, rinfo.address);
			return;
		}
		str = v.name;
		buf.write(str, 5, str.length, 'ascii');
		cursize = str.length + 5;
		buf[cursize++] = 0;
		str = v.string;
		buf.write(str, cursize, str.length, 'ascii');
		cursize += str.length;
		buf[cursize++] = 0;
		buf[2] = cursize >> 8;
		buf[3] = cursize & 255;
		state.controlsocket.send(buf, 0, cursize, rinfo.port, rinfo.address);
		return;
	}

	if (command !== 1)
		return;
	if (msg.toString('ascii', 5, 11) !== 'QUAKE\0')
		return;

	if (msg[11] !== 3) // NET_PROTOCOL_VERSION
	{
		buf[2] = 0;
		buf[3] = 28;
		buf[4] = 0x82;
		buf.write('Incompatible version.\n\0', 5, 23);
		state.controlsocket.send(buf, 0, 28, rinfo.port, rinfo.address);
		return;
	}
	var s;

	// JPG - support for mods
	let mod = 0, modVersion = 0, modFlags = 0
	if (msg.length > 12)
		mod = msg[12]

	if (msg.length > 13)
		modVersion = msg[13]

	if (msg.length > 14)
		modFlags = msg[14]

	if ((i === Object.keys(state.sockets).length) || ((net.state.activeconnections + state.acceptsockets.length) >= sv.state.svs.maxclients))
	{
		buf[2] = 0;
		buf[3] = 22;
		buf[4] = 0x82;
		buf.write('Server is full.\n\0', 5, 17);
		state.controlsocket.send(buf, 0, 22, rinfo.port, rinfo.address);
		return;
	}
	state.acceptsockets.push({
		address: rinfo.address,
		port: rinfo.port, 
		mod: {
			type: mod,
			version: modVersion,
			flags: modFlags
		}
	});
};