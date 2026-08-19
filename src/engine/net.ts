import * as sys from './sys'
import * as con from './console'
import * as sz from './sz'
import * as cl from './cl'
import * as host from './host'
import * as sv from './sv'
import * as cvar from './cvar'
import * as cmd from './cmd'
import * as com from './com'
import * as def from './def'
import * as q from './q'
import * as msg from './msg'
import ISocket from './interfaces/net/ISocket'
import IDatagram from './interfaces/net/IDatagram'
import INetworkDriver from './interfaces/net/INetworkDriver'
import { CVars } from './cvar'
import * as nqnetchan from './nqnetchan'

export const activeSockets: ISocket[] = [];

export const cvr: CVars = {}

interface NetState {
	listening: boolean,
	message: IDatagram,
	activeconnections: number,
	drivers: INetworkDriver[],
	time: number,
	driverlevel: number,
	newsocket: ISocket,
	reps: number,
	start_time: number,
	hostport: number,
	state: boolean
}

export let state: NetState = {
	listening: false,
	drivers: [],
  message: sz.newDatagram(def.max_message),
	activeconnections: 0,
	time: 0,
	driverlevel: 0,
	newsocket: null,
	reps: 0,
	start_time: 0,
	hostport: 26000,
	state: false
}

export const initState = () => {
	state = {
		listening: false,
		drivers: [],
		message: sz.newDatagram(def.max_message),
		activeconnections: 0,
		time: 0,
		driverlevel: 0,
		newsocket: null,
		reps: 0,
		start_time: 0,
		hostport: 26000,
		state: false
	}
}

export const newQSocket = function()
{
	var i;
	for (i = 0; i < activeSockets.length; ++i)
	{
		if (activeSockets[i].disconnected === true)
			break;
	}

	activeSockets[i] = {
		connecttime: state.time,
		lastMessageTime: state.time,
		driver: state.driverlevel,
		address: 'UNSET ADDRESS',
		disconnected: false,
		canSend: false,
		receiveMessage: null,
		receiveMessageLength: 0,
		driverdata: null,
		sendMessage: null,
		sendMessageLength: 0,
		lastSendTime: 0,
		ackSequence: 0,
		sendSequence: 0,
		unreliableSendSequence: 0,
		receiveSequence: 0,
		unreliableReceiveSequence: 0,
		addr: null,
		messages: null,
		sendNext: false
	};
	return activeSockets[i];
};

export const connect = async function(host: string)
{
	state.time = sys.floatTime();

	if (host === 'local')
	{
		state.driverlevel = 0;
		return state.drivers[state.driverlevel].connect(host);
	}

	var dfunc, ret;
	for (state.driverlevel = 1; state.driverlevel < state.drivers.length; ++state.driverlevel)
	{ 
		dfunc = state.drivers[state.driverlevel];
		if (dfunc.initialized !== true) {
			continue;
		}
		if (!dfunc.supportedAddress(host)) {
			continue
		}
		ret = await dfunc.connect(host);
		if (ret === 'connected')
		{
			cl.cls.state = cl.ACTIVE.connecting;
			con.print('['+ dfunc.name + '] trying...\n');
			state.start_time = state.time;
			state.reps = 0;
			throw 'NET.Connect';
		}
		if (ret != 'failed')
			return ret;
	}
};

export const checkForResend = async function()
{
	state.time = sys.floatTime();
	var dfunc = state.drivers[state.newsocket.driver];
	if (state.reps <= 2)
	{
		if ((state.time - state.start_time) >= (2.5 * (state.reps + 1)))
		{
			con.print('['+ dfunc.name + '] still trying...\n');
			++state.reps;
		}
	}
	else if (state.reps === 3)
	{
		if ((state.time - state.start_time) >= 10.0)
		{
			close(state.newsocket);
			cl.cls.state = cl.ACTIVE.disconnected;
			con.print('No Response\n');
			await host.error('NET.CheckForResend: connect failed\n');
		}
	}
	var ret = dfunc.checkForResend();
	if (ret === 1)
	{
		state.newsocket.disconnected = false;

		if (state.newsocket.protocol === 'nqnetchan') {
			const sock = state.newsocket
			if (!sock.ccreqSent) {
				const ccreq = nqnetchan.buildCCREQ()
				dfunc.sendMessage(sock, { data: ccreq, cursize: ccreq.byteLength })
				sock.ccreqSent = true
			}
			for (let i = 0; i < sock.receiveMessage.length; i++) {
				if (nqnetchan.isCCREPAccept(sock.receiveMessage[i])) {
					sock.receiveMessage.splice(i, 1)
					sock.canSend = true
					cl.connect(sock)
					return
				}
			}
			return
		}

		cl.connect(state.newsocket);
	}
	else if (ret === -1)
	{
		state.newsocket.disconnected = false;
		close(state.newsocket);
		cl.cls.state = cl.ACTIVE.disconnected;
		con.print('Network Error\n');
		await host.error('NET.CheckForResend: connect failed\n');
	}
};

export const checkNewConnections = function()
{
	state.time = sys.floatTime();
	var dfunc, ret;
	for (state.driverlevel = 0; state.driverlevel < state.drivers.length; ++state.driverlevel)
	{
		dfunc = state.drivers[state.driverlevel];
		if (dfunc.initialized !== true)
			continue;
		ret = dfunc.checkNewConnections();
		if (ret != null)
			return ret;
	}
};

export const close = function(sock: ISocket)
{
	if (sock == null)
		return;
	// if (sock.disconnected === true)
	// 	return;
	state.time = sys.floatTime();
	state.drivers[sock.driver].close(sock);
	sock.disconnected = true;
};

export const getMessage = function(sock: ISocket)
{
	if (sock == null)
		return -1;
	if (sock.disconnected === true)
	{
		con.print('NET.GetMessage: disconnected socket\n');
		return -1;
	}
	state.time = sys.floatTime();
	// nqnetchan packets that don't yield a deliverable message (ACKs, partial
	// fragments, duplicates) must not end the caller's read loop for this frame
	// — keep consuming the socket queue until it is empty or a message is ready
	// (vanilla Datagram_GetMessage semantics).
	for (;;)
	{
		var ret = state.drivers[sock.driver].getMessage(sock);
		if (sock.driver !== 0)
		{
			if (ret === 0)
			{
				if ((state.time - sock.lastMessageTime) > cvr.messagetimeout.value)
				{
					close(sock);
					return -1;
				}
			}
			else if (ret > 0)
				sock.lastMessageTime = state.time;
		}
		if (ret <= 0 || sock.protocol !== 'nqnetchan')
			return ret;
		const pkt = nqnetchan.parse(state.message.data, state.message.cursize)
		if (pkt.type === 'ack') {
			sock.canSend = true
			continue
		}
		if (pkt.type === 'data') {
			const driver = state.drivers[sock.driver]
			driver.sendMessage(sock, { data: nqnetchan.buildACK(pkt.sequence), cursize: 8 })
			if (pkt.sequence !== sock.receiveSequence) {
				console.warn(`[nqnetchan] out-of-order DATA seq=${pkt.sequence} expected=${sock.receiveSequence}`)
				continue
			}
			sock.receiveSequence++
			// Accumulate fragments; only deliver once EOM is set
			if (sock.fragmentBuffer) {
				const merged = new Uint8Array(sock.fragmentBuffer.length + pkt.payload.length)
				merged.set(sock.fragmentBuffer)
				merged.set(pkt.payload, sock.fragmentBuffer.length)
				sock.fragmentBuffer = merged
			} else {
				sock.fragmentBuffer = new Uint8Array(pkt.payload)
			}
			if (!pkt.eom) continue
			const complete = sock.fragmentBuffer
			sock.fragmentBuffer = undefined
			if (complete.length > state.message.data.byteLength) {
				state.message.cursize = state.message.data.byteLength
				sz.u8(state.message).set(complete.subarray(0, state.message.data.byteLength))
				return 1
			}
			state.message.cursize = complete.length
			sz.u8(state.message).set(complete)
			return 1
		}
		if (pkt.type === 'unreliable') {
			state.message.cursize = pkt.payload.length
			sz.u8(state.message).set(pkt.payload)
			return 2
		}
		if (pkt.type === 'ctl') {
			state.message.cursize = pkt.payload.length
			sz.u8(state.message).set(pkt.payload)
			return 1
		}
		console.warn('[nqnetchan] unknown packet type:', pkt.type, 'size:', state.message.cursize)
	}
};

export const sendMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock == null)
		return -1;
	if (sock.disconnected === true)
	{
		con.print('NET.SendMessage: disconnected socket\n');
		return -1;
	}
	state.time = sys.floatTime();
	if (sock.protocol === 'nqnetchan') {
		const buf = nqnetchan.wrapData(data, sock.sendSequence++)
		sock.canSend = false
		return state.drivers[sock.driver].sendMessage(sock, { data: buf, cursize: buf.byteLength })
	}
	return state.drivers[sock.driver].sendMessage(sock, data);
};

export const sendUnreliableMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock == null)
		return -1;
	if (sock.disconnected === true)
	{
		con.print('NET.SendUnreliableMessage: disconnected socket\n');
		return -1;
	}
	state.time = sys.floatTime();
	if (sock.protocol === 'nqnetchan') {
		const buf = nqnetchan.wrapUnreliable(data, sock.unreliableSendSequence++)
		return state.drivers[sock.driver].sendUnreliableMessage(sock, { data: buf, cursize: buf.byteLength })
	}
	return state.drivers[sock.driver].sendUnreliableMessage(sock, data);
};

export const canSendMessage = function(sock: ISocket)
{
	if (sock == null)
		return;
	if (sock.disconnected === true)
		return;
	state.time = sys.floatTime();
	// For nqnetchan, respect reliable message flow control
	if (sock.protocol === 'nqnetchan' && !sock.canSend)
		return false;
	return state.drivers[sock.driver].canSendMessage(sock);
};

export const sendToAll = async function(data: IDatagram)
{
	var i, 
		count = 0, 
		msg_init = [], 
		msg_sent = [];
	for (i = 0; i < sv.state.svs.maxclients; ++i)
	{
		host.state.client = sv.state.svs.clients[i];
		// Do not send to local clients`
		if (host.state.client.netconnection == null || host.state.client.netconnection.address === 'LOCAL')
			continue;
		if (host.state.client.active !== true)
		{
			msg_init[i] = msg_sent[i] = true;
			continue;
		}
		++count;
		msg_init[i] = msg_sent[i] = false;
	}
	var start = sys.floatTime();
	for (; count !== 0; )
	{
		count = 0;
		for (i = 0; i < sv.state.svs.maxclients; ++i)
		{
			host.state.client = sv.state.svs.clients[i];
			if (host.state.client.netconnection == null)
				continue;
			if (!msg_init[i])
			{
				let canSend = true
				let retry = 0;
				// wait three seconds for each client to process ack and receive reconnect
				while (!(canSend = canSendMessage(host.state.client.netconnection)) && retry++ < 3) {
					getMessage(host.state.client.netconnection);
					con.dPrint('SendToAll - waiting to send\n')
					await new Promise(resolve => setTimeout(resolve, 1000))
				}
				if (canSend)
				{
					msg_init[i] = true;
					sendMessage(host.state.client.netconnection, data);
				} else {
					con.dPrint('SendToAll - could not send to client\n')
				}
				++count;
				continue;
			}
			if (msg_sent[i] !== true)
			{
				if (canSendMessage(host.state.client.netconnection) === true)
					msg_sent[i] = true;
				else
					getMessage(host.state.client.netconnection);
				++count;
			}
		}
		if ((sys.floatTime() - start) > 5.0)
			return count;
	}
	return count;
};

const listen_f = () => {
	if (cmd.state.argv.length !== 2)
	{
		con.print('"listen" is "' + (state.listening === true ? 1 : 0) + '"\n');
		return;
	}
	var listening = (q.atoi(cmd.state.argv[1]) !== 0);
	if (state.listening === listening)
		return;
	state.listening = listening;
	
	for (state.driverlevel = 0; state.driverlevel < state.drivers.length; ++state.driverlevel)
	{
		const driver = state.drivers[state.driverlevel]
		driver.init();
		if (driver.initialized === true)
			driver.listen();
	}
}

const maxPlayers_f = function()
{
	if (cmd.state.argv.length !== 2)
	{
		con.print('"maxplayers" is "' + sv.state.svs.maxclients + '"\n');
		return;
	}
	if (sv.state.server.phase === 'active')
	{
		con.print('maxplayers can not be changed while a server is running.\n');
		return;
	}
	var n = q.atoi(cmd.state.argv[1]);
	if (n <= 0)
		n = 1;
	else if (n > sv.state.svs.maxclientslimit)
	{
		n = sv.state.svs.maxclientslimit;
		con.print('"maxplayers" set to "' + n + '"\n');
	}
	if ((n === 1) && (state.listening === true))
		cmd.state.text += 'listen 0\n';
	else if ((n >= 2) && (state.listening !== true))
		cmd.state.text += 'listen 1\n';
	sv.state.svs.maxclients = n;
	if (n === 1)
		cvar.set('deathmatch', '0');
	else
		cvar.set('deathmatch', '1');
};

const port_f = function()
{
	if (cmd.state.argv.length !== 2)
	{
		con.print('"port" is "' + state.hostport + '"\n');
		return;
	}
	var n = q.atoi(cmd.state.argv[1]);
	if ((n <= 0) || (n >= 65535))
	{
		con.print('Bad value, must be between 1 and 65534\n');
		return;
	}
	state.hostport = n;
	if (state.listening === true)
		cmd.state.text += 'listen 0\nlisten 1\n';
};

export const init = (drivers: INetworkDriver[]) => {
	state.time = sys.floatTime();

	cvr.messagetimeout = cvar.registerVariable('net_messagetimeout', '10');
	cvr.hostname = cvar.registerVariable('hostname', com.getCmdParam('hostname') || 'UNNAMED');
	cvr.web_connect_url = cvar.registerVariable('web_connect_url', '');
	cvr.enable_webrtc = cvar.registerVariable('enable_webrtc', com.getCmdDeclaration('webrtc') ? '1' : '0');
	cmd.addCommand('listen', listen_f);
	cmd.addCommand('maxplayers', maxPlayers_f);
	cmd.addCommand('port', port_f);

	state.drivers = drivers;
	for (state.driverlevel = 0; state.driverlevel < state.drivers.length; ++state.driverlevel)
	{
		state.drivers[state.driverlevel].init();
	}

	state.listening = com.checkParm('-listen') != null || host.state.dedicated;
	if (state.listening) {
		var i = com.checkParm('-port');
		if (i != null)
		{
			i = q.atoi(com.state.argv[i + 1]);
			if ((i > 0) && (i <= 65534))
				state.hostport = i;
		}
		for (state.driverlevel = 0; state.driverlevel < state.drivers.length; ++state.driverlevel)
		{
			const driver = state.drivers[state.driverlevel]
			if (driver.initialized === true)
				driver.listen();
		}
	}
};

export const shutdown = function()
{
	state.time = sys.floatTime();
	for (var i = 0; i < activeSockets.length; ++i) {
		const sock = activeSockets[i]
		if (sock.protocol === 'nqnetchan' && !sock.disconnected) {
			// Send clc_disconnect (byte 2) so FTE cleanly removes the player.
			// "drop" stringcmd is QW-only; NQ clients must use clc_disconnect.
			const payload = new Uint8Array([2]) // CLC.disconnect
			const wrapped = nqnetchan.wrapUnreliable({ data: payload.buffer, cursize: 1 }, sock.unreliableSendSequence)
			state.drivers[sock.driver].sendMessage(sock, { data: wrapped, cursize: wrapped.byteLength })
		}
	}
	for (var i = 0; i < activeSockets.length; ++i)
		close(activeSockets[i]);
	for (state.driverlevel = 0; state.driverlevel < state.drivers.length; ++state.driverlevel)
	{
		const driver = state.drivers[state.driverlevel]
		if (driver.shutdown)
			driver.shutdown();
	}
};

export const registerWithMaster = () => {
	for (const driver of state.drivers) {
		if (driver.initialized) {
			driver.registerWithMaster()
		}
	}
}