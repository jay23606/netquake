<template>
  <div class="sb-lobby">
    <h1>Peer-to-peer Multiplayer</h1>
    <p class="sub">
      Rooms and signaling run on Supabase. Once connected, game traffic is
      direct between players — it never passes through a server.
    </p>

    <p v-if="!store.available" class="err">
      Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
    </p>

    <template v-else>
      <p v-if="store.error" class="err">{{ store.error }}</p>

      <section v-if="!store.playerId" class="panel">
        <label>Player name</label>
        <input v-model="name" maxlength="15" placeholder="ranger" @keyup.enter="signIn" />
        <button :disabled="busy" @click="signIn">Continue</button>
      </section>

      <template v-else-if="!store.room">
        <section class="panel">
          <h2>Host a game</h2>
          <input v-model="roomName" maxlength="30" placeholder="room name" />
          <select v-model="map">
            <option v-for="m in maps" :key="m" :value="m">{{ m }}</option>
          </select>
          <button :disabled="busy" @click="host">Host</button>
        </section>

        <section class="panel">
          <h2>Join by code</h2>
          <input v-model="code" maxlength="5" placeholder="ABCDE" @keyup.enter="join" />
          <button :disabled="busy" @click="join">Join</button>
        </section>

        <section class="panel">
          <h2>Open rooms <button class="link" @click="refresh">refresh</button></h2>
          <p v-if="!openRooms.length" class="muted">No open rooms.</p>
          <ul v-else>
            <li v-for="r in openRooms" :key="r.id">
              <strong>{{ r.name }}</strong>
              <span class="muted">{{ r.map }} · {{ r.code }}</span>
              <button :disabled="busy" @click="joinRoom(r.code)">Join</button>
            </li>
          </ul>
        </section>
      </template>

      <section v-else class="panel">
        <h2>{{ store.room.name }}</h2>
        <p>
          Share this code: <strong class="code">{{ store.room.code }}</strong>
        </p>
        <p class="muted">
          Map {{ store.room.map }} · {{ store.isHost ? 'you are hosting' : 'joined' }}
          · {{ store.players.length }} player(s)
        </p>
        <button :disabled="busy" @click="launch">
          {{ store.isHost ? 'Start game' : 'Enter game' }}
        </button>
        <button class="link" :disabled="busy" @click="leave">Leave</button>
      </section>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSupabaseRoomStore } from '../../../stores/supabaseRoom'
import type { Room } from '../../../../../shared/supabase/rooms'

const router = useRouter()
const store = useSupabaseRoomStore()

const name = ref('')
const roomName = ref('')
const code = ref('')
const map = ref('e1m1')
const busy = ref(false)
const openRooms = ref<Room[]>([])

// Shareware episode 1 only: these are the maps every player is guaranteed to
// have, since pak1 is not distributed.
const maps = ['e1m1', 'e1m2', 'e1m3', 'e1m4', 'e1m5', 'e1m6', 'e1m7', 'e1m8', 'dm1', 'dm2', 'dm3']

const run = async (fn: () => Promise<unknown>) => {
  busy.value = true
  try { await fn() } catch { /* surfaced via store.error */ } finally { busy.value = false }
}

const signIn = () => run(async () => {
  await store.signIn(name.value || 'player')
  await refresh()
})

const refresh = () => run(async () => { openRooms.value = await store.list() })

const host = () => run(async () => {
  await store.host(roomName.value || `${store.playerName}'s game`, map.value)
})

const join = () => run(() => store.join(code.value))
const joinRoom = (c: string) => run(() => store.join(c))
const leave = () => run(() => store.leave())

// Mirrors the legacy room flow: the host listens, everyone else dials the
// magic room address that routes through the injected broker.
const launch = () => {
  const query: Record<string, string> = store.isHost
    ? { '-listen': '16', '+map': store.room!.map }
    : { '-connect': 'rtc://netquake.io/room' }
  router.push({ path: '/mp/quake', query })
}

onMounted(() => { if (store.playerId) void refresh() })
</script>

<style lang="scss" scoped>
.sb-lobby { max-width: 760px; margin: 0 auto; padding: 32px 24px; }
.sub { opacity: 0.75; margin-bottom: 24px; }
.panel { border: 1px solid rgba(128,128,128,0.35); padding: 16px; margin-bottom: 16px; }
.panel h2 { margin: 0 0 12px; font-size: 1rem; text-transform: uppercase; }
.panel input, .panel select { margin-right: 8px; padding: 6px 8px; }
.err { color: #d9534f; }
.muted { opacity: 0.7; }
.code { letter-spacing: 3px; font-size: 1.4rem; }
button { padding: 6px 14px; cursor: pointer; }
button.link { background: none; border: none; text-decoration: underline; }
ul { list-style: none; padding: 0; }
li { display: flex; gap: 12px; align-items: center; padding: 6px 0; }
</style>
