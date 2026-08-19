import * as sz from './sz'
import * as net from './net'
import IDatagram from './interfaces/net/IDatagram'
import { PRFL } from './protocol'

export const state = {} as any

export const writeChar = function(message: IDatagram, c: number)
{
	sz.dataView(message).setInt8(sz.getSpace(message, 1), c);
};

export const writeByte = function(message: IDatagram, c: number)
{
	sz.dataView(message).setUint8(sz.getSpace(message, 1), c);
};

export const writeShort = function(message: IDatagram, c: number)
{
	sz.dataView(message).setInt16(sz.getSpace(message, 2), c, true);
};

export const writeLong = function(message: IDatagram, c: number)
{
	sz.dataView(message).setInt32(sz.getSpace(message, 4), c, true);
};

export const writeFloat = function(message: IDatagram, f: number)
{
	sz.dataView(message).setFloat32(sz.getSpace(message, 4), f, true);
};

export const writeString = function(message: IDatagram, s: string)
{
	if (s != null)
	{
		// ToUint8 element store truncates identically to strmem's & 255
		var u8 = sz.u8(message), ofs = sz.getSpace(message, s.length);
		for (var i = 0; i < s.length; ++i)
			u8[ofs + i] = s.charCodeAt(i);
	}
	writeChar(message, 0)
};

export const writeCoord = function(message: IDatagram, f: number, flags: number)
{
	if (flags & PRFL.FLOATCOORD)
		writeFloat(message, f);
	else if (flags & PRFL.INT32COORD)
		writeLong(message, Math.round(f * 16.0));
	else if (flags & PRFL.COORD24) {
		writeShort(message, f);
		writeByte(message, ((f * 255) | 0) % 255);
	} else
		writeShort(message, f * 8.0);
};

// QSS-M common.c:1314-1320: round the SCALED value (Q_rint), never truncate f first --
// pre-truncating to whole degrees would quantize 16-bit angles back to 1-degree steps.
export const writeAngle = function(message: IDatagram, f: number, flags: number)
{
	if (flags & PRFL.FLOATANGLE)
		writeFloat(message, f);
	else if (flags & PRFL.SHORTANGLE)
		writeShort(message, Math.round(f * (65536.0 / 360.0)) & 65535);
	else
		writeByte(message, Math.round(f * (256.0 / 360.0)) & 255);
};

// FitzQuake 666's fixed 16-bit CLC_MOVE angle -- always short-precision regardless of
// protocolFlags (666 carries no flags long), so no flags param.
export const writeAngle16 = function(message: IDatagram, f: number)
{
	writeShort(message, Math.round(f * (65536.0 / 360.0)) & 65535);
};

export const beginReading = function()
{
	state.readcount = 0;
	state.badread = false;
};

export const readChar = function()
{
	const count = state.readcount
	if (count >= net.state.message.cursize)
	{
		state.badread = true;
		return -1;
	}
	var c = sz.dataView(net.state.message).getInt8(count);
	++state.readcount;
	return c;
};

export const readByte = function()
{
	if (state.readcount >= net.state.message.cursize)
	{
		state.badread = true;
		return -1;
	}
	var c = sz.u8(net.state.message)[state.readcount];
	++state.readcount;
	return c;
};

export const readShort = function()
{
	if ((state.readcount + 2) > net.state.message.cursize)
	{
		state.badread = true;
		return -1;
	}
	var c = sz.dataView(net.state.message).getInt16(state.readcount, true);
	state.readcount += 2;
	return c;
};

export const readLong = function()
{
	if ((state.readcount + 4) > net.state.message.cursize)
	{
		state.badread = true;
		return -1;
	}
	var c = sz.dataView(net.state.message).getInt32(state.readcount, true);
	state.readcount += 4;
	return c;
};

export const readFloat = function()
{
	if ((state.readcount + 4) > net.state.message.cursize)
	{
		state.badread = true;
		return -1;
	}
	var f = sz.dataView(net.state.message).getFloat32(state.readcount, true);
	state.readcount += 4;
	return f;
};

export const readString = function()
{
	var string = '', l, c;
	for (l = 0; l < 2048; ++l)
	{
		c = readByte();
		if (c <= 0)
			break;
		string += String.fromCharCode(c);
	}
	return string;
};

export const readData = function(size: number): Uint8Array
{
	if ((state.readcount + size) > net.state.message.cursize)
	{
		state.badread = true;
		return new Uint8Array(0);
	}
	const copy = new Uint8Array(size);
	copy.set(sz.u8(net.state.message).subarray(state.readcount, state.readcount + size));
	state.readcount += size;
	return copy;
};

export const readCoord = function(flags: number)
{
	if (flags & PRFL.FLOATCOORD)
		return readFloat();
	if (flags & PRFL.INT32COORD)
		return readLong() * 0.0625;
	if (flags & PRFL.COORD24)
		return readShort() + readByte() * (1.0 / 255);
	return readShort() * 0.125;
};

export const readAngle = function(flags: number)
{
	if (flags & PRFL.FLOATANGLE)
		return readFloat();
	if (flags & PRFL.SHORTANGLE)
		return readShort() * (360.0 / 65536);
	return readChar() * 1.40625;
};

// Counterpart to writeAngle16 -- always short-precision, no flags param.
export const readAngle16 = function()
{
	return readShort() * (360.0 / 65536);
};