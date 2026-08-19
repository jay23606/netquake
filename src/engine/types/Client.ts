import type IDatagram from "../interfaces/net/IDatagram";
import type ISocket from "../interfaces/net/ISocket";
import type { Edict } from "./Edict";
import type { V3 } from "./Vector";

export type Client = {
	num: number
	name: string
	message: IDatagram
	colors: number;
	old_frags: number;
	active: boolean;
	spawn_parms: number[];
	netconnection?: ISocket;
	dropasap: boolean;
	last_message?: number;
	cmd: {
		forwardmove: number;
		sidemove: number;
		upmove: number;
	}
	wishdir: V3;
	edict?: Edict;
	ping_times?: number[];
	num_pings?: number;
  spawned: boolean;
  reconnect: boolean;
  sendsignon: boolean;
  // spam protection
  lastspoke: number;
  floodprotmessage: number;
  lockedtill: number
}