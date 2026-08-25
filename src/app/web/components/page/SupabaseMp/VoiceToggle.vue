<template>
  <div class="voice">
    <div class="voice-row">
      <button
        type="button"
        class="voice-btn"
        :class="{ on: isTalking, busy: status === 'starting' }"
        :title="hint"
        :aria-label="hint"
        @click="onClick"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
          <path fill="currentColor" d="M17 11a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11Z" />
          <path v-if="!isTalking" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 3 20 21" />
        </svg>
        <span class="voice-label">{{ label }}</span>
      </button>

      <button
        type="button"
        class="voice-btn"
        :class="{ on: cameraOn, busy: cameraBusy }"
        :title="cameraHint"
        :aria-label="cameraHint"
        @click="onCameraClick"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
          <path fill="currentColor" d="m18 10 4-2.5v9L18 14Z" />
          <path v-if="!cameraOn" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 3 20 21" />
        </svg>
        <span class="voice-label">{{ cameraLabel }}</span>
      </button>
    </div>

    <p v-if="detail" class="voice-detail">{{ detail }}</p>

    <!-- Never interactive: pointer lock means a click here was meant for the
         game, and a tile that swallowed it would be maddening. -->
    <div class="tiles" aria-hidden="true">
      <video
        v-for="id in tileIds"
        :key="id"
        :ref="el => bindTile(el, id)"
        autoplay
        playsinline
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useSupabaseRoomStore } from '../../../stores/supabaseRoom'
import { VoiceChat, type VoiceStatus } from '../../../../../shared/supabase/voice'

// Voice is push-to-mute rather than push-to-talk: the mic opens once and the
// toggle flips the track. See shared/supabase/voice.ts for why the track is
// attached up front rather than on unmute.
//
// The camera is the exception. foyer attaches tracks when a connection is
// built, so adding video to a mesh already carrying voice rebuilds it -- a
// reconnect of a second or two, which is why that button has a busy state and
// the microphone does not.

const store = useSupabaseRoomStore()

// Held outside reactive state on purpose. VoiceChat owns live
// RTCPeerConnections and MediaStreams, and Vue's deep proxying of those is the
// same trap the signaling broker had to be kept out of. The remote streams
// below are kept out for exactly the same reason: only their ids are reactive.
let voice: VoiceChat | null = null
const streams = new Map<string, MediaStream>()

const status = ref<VoiceStatus>('off')
const muted = ref(true)
const detail = ref('')
const cameraOn = ref(false)
const cameraBusy = ref(false)
const cameraNote = ref('')
const tileIds = ref<string[]>([])

const isTalking = computed(() => status.value === 'live' && !muted.value)

const label = computed(() => {
  switch (status.value) {
    case 'starting': return 'Mic...'
    case 'live': return muted.value ? 'Muted' : 'Live'
    case 'denied': return 'Blocked'
    case 'unavailable': return 'No mic'
    default: return 'Voice'
  }
})

const hint = computed(() => {
  switch (status.value) {
    case 'live': return muted.value
      ? 'Microphone muted. Click or press M to talk.'
      : 'Microphone live. Click or press M to mute.'
    case 'denied': return 'The browser blocked microphone access for this site.'
    case 'unavailable': return detail.value || 'No microphone available.'
    default: return 'Turn on voice chat (press M)'
  }
})

const cameraLabel = computed(() => {
  if (cameraBusy.value) return 'Cam...'
  if (cameraNote.value) return cameraNote.value
  return cameraOn.value ? 'Cam on' : 'Cam'
})

const cameraHint = computed(() => {
  if (cameraNote.value) return cameraNote.value
  return cameraOn.value
    ? 'Camera on. Click or press V to turn it off.'
    : 'Turn on your camera (press V). Quality follows the number of players.'
})

// Both the click and the keypress are user gestures, which is what
// getUserMedia and audio playback require.
const onClick = () => { void activate() }
const onCameraClick = () => { void toggleCamera() }

const activate = async () => {
  if (!voice) return
  if (voice.currentStatus === 'live') {
    muted.value = voice.toggleMuted()
    return
  }
  if (voice.currentStatus === 'starting') return
  const result = await voice.start()
  // Unmute straight away: the player asked for voice, so making them press
  // twice to be heard would be a needless second step.
  if (result === 'live') muted.value = voice.toggleMuted()
}

const toggleCamera = async () => {
  if (!voice || cameraBusy.value) return
  cameraBusy.value = true
  cameraNote.value = ''
  const wanted = !cameraOn.value
  // Turning the camera off drops every tile: the streams belong to the mesh
  // that is about to be rebuilt.
  if (!wanted) clearTiles()
  const result = await voice.setCamera(wanted)
  cameraBusy.value = false
  if (wanted && result !== 'live') {
    cameraOn.value = false
    cameraNote.value = result === 'denied' ? 'Blocked' : 'No cam'
    return
  }
  cameraOn.value = wanted && voice.cameraOn
  if (result === 'live') muted.value = voice.muted
}

const clearTiles = () => {
  streams.clear()
  tileIds.value = []
}

// The element arrives after the id does, so the stream is attached here rather
// than when it was received.
const bindTile = (el: unknown, id: string) => {
  const video = el as HTMLVideoElement | null
  const stream = streams.get(id)
  if (video && stream && video.srcObject !== stream) video.srcObject = stream
}

const onKey = (event: KeyboardEvent) => {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
  if (event.code === 'KeyM') { event.preventDefault(); void activate(); return }
  if (event.code === 'KeyV') { event.preventDefault(); void toggleCamera() }
}

onMounted(() => {
  const roomId = store.room?.id
  const playerId = store.playerId
  if (!roomId || !playerId) return
  voice = new VoiceChat(roomId, playerId)
  voice.onStatus((s, why) => {
    status.value = s
    detail.value = s === 'denied' || s === 'unavailable' ? (why ?? '') : ''
    if (s === 'off') clearTiles()
  })
  voice.onStream((peerId, stream) => {
    streams.set(peerId, stream)
    if (!tileIds.value.includes(peerId)) tileIds.value = [...tileIds.value, peerId]
  })
  voice.onLeave(peerId => {
    streams.delete(peerId)
    tileIds.value = tileIds.value.filter(id => id !== peerId)
  })
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  voice?.stop()
  voice = null
  clearTiles()
})
</script>

<style lang="scss" scoped>
// Above the game canvas, and clear of the top-right corner Quake itself uses.
.voice { position: absolute; top: 12px; right: 12px; z-index: 30; text-align: right; }

.voice-row { display: flex; gap: 6px; justify-content: flex-end; }

.voice-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 9px;
  color: rgba(235, 235, 235, 0.55);
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(128, 128, 128, 0.45);
  border-radius: 3px;
  cursor: pointer;
  font: inherit;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.voice-btn:hover { border-color: rgba(200, 200, 200, 0.7); }
.voice-btn.busy { opacity: 0.7; cursor: progress; }
.voice-btn.on {
  color: #7ad17a;
  border-color: rgba(122, 209, 122, 0.6);
}

.voice-label { line-height: 1; }

.voice-detail {
  margin: 6px 0 0;
  max-width: 220px;
  font-size: 0.7rem;
  opacity: 0.75;
  color: rgba(235, 235, 235, 0.9);
}

// Small on purpose. foyer scales the encoding to the number of players, so a
// full server sends thumbnails; showing them large would only magnify that.
.tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
  margin-top: 6px;
  max-width: 340px;
  pointer-events: none;
}
.tiles video {
  width: 104px;
  height: 78px;
  object-fit: cover;
  background: #111;
  border: 1px solid rgba(128, 128, 128, 0.45);
  border-radius: 2px;
}
</style>
