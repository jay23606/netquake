import * as sys from './sys'
import * as con from './console'
import IDatagram from './interfaces/net/IDatagram';

export const getSpace = function(buf: IDatagram, length: number)
{
	if ((buf.cursize + length) > buf.data.byteLength)
	{
		if (buf.allowoverflow !== true)
			sys.error('SZ.GetSpace: overflow without allowoverflow set');
		if (length > buf.data.byteLength)
			sys.error('SZ.GetSpace: ' + length + ' is > full buffer size');
		buf.overflowed = true;
		con.print('SZ.GetSpace: overflow\n');
		buf.cursize = 0;
	}
	var cursize = buf.cursize;
	buf.cursize += length;
	return cursize;
};

// SZ_Alloc: construct every datagram here so the cached views exist from birth and
// per-frame code never needs to build a view over .data (see IDatagram). A function
// declaration (not const) so module-scope state literals in the sz<->net/sv import
// cycle can call it before sz's body has evaluated (hoisted at instantiation).
export function newDatagram(size: number, cursize: number = 0): IDatagram
{
	const data = new ArrayBuffer(size);
	return { data: data, cursize: cursize, view: new DataView(data), u8: new Uint8Array(data) };
}

export const dataView = function(buf: IDatagram)
{
	if ((buf.view == null) || (buf.view.buffer !== buf.data))
		buf.view = new DataView(buf.data);
	return buf.view;
};

export const u8 = function(buf: IDatagram)
{
	if ((buf.u8 == null) || (buf.u8.buffer !== buf.data))
		buf.u8 = new Uint8Array(buf.data);
	return buf.u8;
};

export const write = function(message: IDatagram, data:Uint8Array, length: number)
{
	if (length === 0)
		return;  // the per-frame reliable-datagram append is usually empty
	u8(message).set(length === data.length ? data : data.subarray(0, length), getSpace(message, length));
};

// Don't think this is used. 
// export const print = function(message: IDatagram, data:Uint8Array)
// {
// 	var buf = new Uint8Array(message.data);
// 	var dest;
// 	if (message.cursize !== 0)
// 	{
// 		if (buf[message.cursize - 1] === 0)
// 			dest = getSpace(message, data.length - 1) - 1;
// 		else
// 			dest = getSpace(message, data.length);
// 	}
// 	else
// 		dest = getSpace(message, data.length);
	
// 	for (let i = 0; i < data.length; ++i)
// 		buf[dest + i] = data.charCodeAt(i);
// };