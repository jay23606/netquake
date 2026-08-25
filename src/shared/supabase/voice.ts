import { createVoiceMesh, type VoiceMesh } from '@jay23606/foyer'
import { getSupabase, iceServers } from './client'

// Voice chat, now provided by foyer.
//
// This file used to hold the mesh itself. It was extracted into
// https://github.com/jay23606/foyer after the same peer-to-peer plumbing had
// been written for a fourth time across these projects, and netquake is its
// first consumer.
//
// What survives here is the adapter: foyer wants a supabase client and a
// stable id per participant, and this supplies netquake's. The class shape is
// unchanged so the Quake 1 toggle and the Quake 2 control did not have to move.
//
// The design notes that used to live here -- why voice is always a mesh, why
// the microphone track is attached when the connection is built rather than on
// unmute, why the offerer is settled by comparing ids -- now live in foyer's
// voice.ts, next to the code they explain.

export type { VoiceStatus, VoiceListener } from '@jay23606/foyer'

export class VoiceChat {
	private readonly mesh: VoiceMesh

	constructor(roomId: string, playerId: string) {
		this.mesh = createVoiceMesh({
			supabase: getSupabase(),
			roomId,
			playerId,
			iceServers: iceServers(),
		})
	}

	get muted() { return this.mesh.muted }
	get currentStatus() { return this.mesh.currentStatus }
	get peerCount() { return this.mesh.peerCount }

	onStatus = (listener: Parameters<VoiceMesh['onStatus']>[0]) => this.mesh.onStatus(listener)
	start = () => this.mesh.start()
	stop = () => { this.mesh.stop() }
	setMuted = (muted: boolean) => { this.mesh.setMuted(muted) }
	toggleMuted = () => this.mesh.toggleMuted()
}
