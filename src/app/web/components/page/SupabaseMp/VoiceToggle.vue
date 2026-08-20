<template>
  <div class="voice" :class="{ 'is-on': isTalking }">
    <button
      type="button"
      class="voice-btn"
      :class="{ muted: !isTalking, busy: status === 'starting' }"
      :title="hint"
      :aria-label="hint"
      @click="onClick"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        />
        <path
          fill="currentColor"
          d="M17 11a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11Z"
        />
        <path
          v-if="!isTalking"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          d="M4 3 20 21"
        />
      </svg>
      <span class="voice-label">{{ label }}</span>
    </button>
    <p v-if="detail" class="voice-detail">{{ detail }}</p>
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useSupabaseRoomStore } from '../../../stores/supabaseRoom'
import { VoiceChat, type VoiceStatus } from '../../../../../shared/supabase/voice'

// Voice is push-to-mute rather than push-to-talk: the mic opens once and the
// toggle flips the track. See shared/supabase/voice.ts for why the track is
// attached up front rather than on unmute.

const store = useSupabaseRoomStore()

// Held outside reactive state on purpose. VoiceChat owns live
// RTCPeerConnections and MediaStreams, and Vue's deep proxying of those is the
// same trap the signaling broker had to be kept out of.
let voice: VoiceChat | null = null

const status = ref<VoiceStatus>('off')
const muted = ref(true)
const detail = ref('')

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

// Both the click and the keypress are user gestures, which is what
// getUserMedia and audio playback require.
const onClick = () => { void activate() }

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

const onKey = (event: KeyboardEvent) => {
  if (event.code !== 'KeyM' || event.repeat) return
  if (event.ctrlKey || event.altKey || event.metaKey) return
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
  event.preventDefault()
  void activate()
}

onMounted(() => {
  const roomId = store.room?.id
  const playerId = store.playerId
  if (!roomId || !playerId) return
  voice = new VoiceChat(roomId, playerId)
  voice.onStatus((s, why) => {
    status.value = s
    detail.value = s === 'denied' || s === 'unavailable' ? (why ?? '') : ''
  })
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  voice?.stop()
  voice = null
})
</script>

<style lang="scss" scoped>
// Above the game canvas, and clear of the top-right corner Quake itself uses.
.voice { position: absolute; top: 12px; right: 12px; z-index: 30; text-align: right; }

.voice-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  color: rgba(235, 235, 235, 0.9);
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(128, 128, 128, 0.45);
  border-radius: 3px;
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.voice-btn:hover { border-color: rgba(200, 200, 200, 0.7); }
.voice-btn.muted { color: rgba(235, 235, 235, 0.55); }
.voice-btn.busy { opacity: 0.7; cursor: progress; }

.is-on .voice-btn {
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
</style>
