import * as q from '../../engine/q'
import * as host from '../../engine/host'
import * as com from '../../engine/com'
import * as _assetStore from './assetStore'
import * as webs from './net/webs'
import * as webrtc from './net/webrtc'
import * as datagram from './net/datagram'
import * as fs from 'fs'
import * as con from '../../engine/console'

export const assetStore = _assetStore

type LogDescriptor = number | 'ERROR'
var commandBuffer = ''
var oldTime: null | [number, number] = null
let logFd: LogDescriptor = 0

export const quit = (): void => {
	process.exit(0);
}

export const print = (text: string): void => {
	process.stdout.write(text);
	if (con.state.debuglog && logFd !== 'ERROR') {
		if (!logFd) {
			try {
				logFd = fs.openSync('qconsole.log', 'a')
			} catch(err) {
				logFd = 'ERROR'
				process.stdout.write('Error opening qconsole.log: '+ err.message);
				return
			}
		}
		fs.appendFileSync(logFd, text)
	}
}

export const error = (text: string): void => {
	console.log(text);
	throw new Error(text);
}

export const floatTime = (): number =>{
	var time = process.hrtime(oldTime);
	return time[0] + (time[1] / 1000000000.0);
}

export const getExternalCommand = (): string => {
	var text = commandBuffer;
	if (text.length === 0)
		return;
  	commandBuffer = '';
	return text;
}

const onConsoleInput = (data: Uint8Array) => {
  commandBuffer += q.memstr(data);
}

function getNanoSecTime() {
  var hrTime = process.hrtime();
  return hrTime[0] * 1000000000 + hrTime[1];
}

const startGameLoop = () => {
	const _gameLoop = async () => {
		try{
			await host.frame();
		} 
		catch(e) {
			if(e && e.message)
			{
				console.log(e && e.message)
				console.log(e && e.stack)
				quit()
			}
		}
		
		setTimeout(_gameLoop, host.cvr.ticrate.value * 1000.0);
  	}
  	_gameLoop()
}

export const init = async (argv: string) => {
	q.state.isNaN = (val: number) => Number.isNaN(val)
	com.initArgv(process.argv.slice(1));
	oldTime = process.hrtime();
	print('Host.Init\n');
	
	await host.init(true, assetStore, [webs, webrtc, datagram])
	
	process.stdin.resume();
	process.stdin.on('data', onConsoleInput);
	process.nextTick(startGameLoop);
}

export const requestPak = () => {
	return Promise.resolve()
}