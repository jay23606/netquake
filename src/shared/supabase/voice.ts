import { createVoiceMesh, type VoiceMesh, type VoiceStatus } from '@jay23606/foyer'
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

	get cameraOn() { return this.video }
	private video = false

	onStatus = (listener: Parameters<VoiceMesh['onStatus']>[0]) => this.mesh.onStatus(listener)
	onStream = (listener: Parameters<VoiceMesh['onStream']>[0]) => this.mesh.onStream(listener)
	onLeave = (listener: Parameters<VoiceMesh['onLeave']>[0]) => this.mesh.onLeave(listener)

	start = () => this.mesh.start()
	stop = () => { this.video = false; this.mesh.stop() }
	setMuted = (muted: boolean) => { this.mesh.setMuted(muted) }
	toggleMuted = () => this.mesh.toggleMuted()

	/**
	 * Turns the camera on or off.
	 *
	 * foyer attaches tracks when a connection is built, deliberately, so that
	 * nothing renegotiates mid-call. The cost is that adding a camera to a mesh
	 * already carrying only voice means rebuilding it -- a reconnect of a second
	 * or two. Muting still just flips a track; this is the one control that
	 * cannot.
	 *
	 * Quality is not set here. foyer picks it from how many people are
	 * listening, so two players get a decent picture and a full server gets
	 * small tiles without anything here having an opinion.
	 */
	setCamera = async (on: boolean): Promise<VoiceStatus> => {
		const wasMuted = this.mesh.muted
		this.mesh.stop()
		this.video = on
		const status = await this.mesh.start(
			on
				? { audio: true, video: { width: { ideal: 320 }, height: { ideal: 240 } } }
				: undefined
		)
		if (status === 'live') this.mesh.setMuted(wasMuted)
		else this.video = false
		return status
	}
}
