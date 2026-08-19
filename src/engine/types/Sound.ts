import { V3 } from "./Vector"

export type SoundCache = {
    loopstart: number
    length: number
    size: number
    data: AudioBuffer
}

export type Sound = {
    name: string,
    cache: SoundCache
    data: ArrayBuffer,
    type: string
    loading?: Promise<boolean>
}

export type Nodes = {
    state: 'end' | 'playing' | 'idle',
	source: AudioBufferSourceNode,
	gain: GainNode,
	merger1: ChannelMergerNode,
	splitter: ChannelSplitterNode,
	gain0: GainNode,
	gain1: GainNode,
	merger2: ChannelMergerNode
}

export type Channel = {
	sfx: Sound, 
	end: number, 
    pos: number
	master_vol: number
    leftvol: number
    rightvol: number
	nodes: Nodes
    entnum: number
    entchannel: number
    dist_mult: number
    origin: V3
}
