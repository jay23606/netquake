<template>
  <div class="sb-lobby">
    <h1>Peer-to-peer Multiplayer</h1>
    <p class="sub">
      Rooms and signaling run on Supabase. Once connected, game traffic goes
      direct between players and never passes through a server.
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
        <section class="panel rooms">
          <h2>
            Open games
            <span class="live" :class="{ on: live }">{{ live ? 'live' : 'offline' }}</span>
          </h2>

          <p v-if="!openRooms.length" class="muted">
            Nobody is hosting right now. Start a game below and it will appear
            here for everyone else.
          </p>

          <ul v-else>
            <li v-for="r in openRooms" :key="r.id">
              <div class="who">
                <strong>{{ r.name }}</strong>
                <span class="muted">{{ hostOf(r) }} &middot; {{ r.map }} &middot; {{ count(r) }}/{{ r.max_players }} players &middot; {{ age(r) }}</span>
              </div>
              <button :disabled="busy || count(r) >= r.max_players" @click="joinRoom(r)">
                {{ count(r) >= r.max_players ? 'Full' : 'Join' }}
              </button>
            </li>
          </ul>
        </section>

        <section class="panel">
          <h2>Host a game</h2>
          <input v-model="roomName" maxlength="30" placeholder="room name" />
          <select v-model="map">
            <option v-for="m in maps" :key="m" :value="m">{{ m }}</option>
          </select>
          <button :disabled="busy" @click="host">Host</button>
        </section>

        <section class="panel secondary">
          <button class="link" @click="showCode = !showCode">
            {{ showCode ? 'Hide' : 'Join by code instead' }}
          </button>
          <div v-if="showCode" class="code-entry">
            <input v-model="code" maxlength="5" placeholder="ABCDE" @keyup.enter="joinByCode" />
            <button :disabled="busy" @click="joinByCode">Join</button>
          </div>
        </section>
      </template>

      <section v-else class="panel">
        <h2>{{ store.room.name }}</h2>
        <p class="muted">
          Map {{ store.room.map }} · {{ store.isHost ? 'you are hosting' : 'joined' }}
          · {{ store.players.length }} player(s)
        </p>
        <p class="muted">Code <strong class="code">{{ store.room.code }}</strong></p>
        <button :disabled="busy" @click="launch">
          {{ store.isHost ? 'Start game' : 'Enter game' }}
        </button>
        <button class="link" :disabled="busy" @click="leave">Leave</button>
      </section>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSupabaseRoomStore } from '../../../stores/supabaseRoom'
import { playerCount, hostName, subscribeRooms, leaveRoomOnUnload, type Room } from '../../../../../shared/supabase/rooms'

const router = useRouter()
const store = useSupabaseRoomStore()

const name = ref('')
const roomName = ref('')
const code = ref('')
const map = ref('e1m1')
const busy = ref(false)
const live = ref(false)
const showCode = ref(false)
const openRooms = ref<Room[]>([])

let unsubscribe: (() => void) | null = null

// Shareware episode 1 and its deathmatch maps: the only ones every player is
// guaranteed to have, since pak1 is not distributed.
const maps = ['e1m1', 'e1m2', 'e1m3', 'e1m4', 'e1m5', 'e1m6', 'e1m7', 'e1m8', 'dm1', 'dm2', 'dm3']

const count = (r: Room) => playerCount(r)
const hostOf = (r: Room) => hostName(r)

// Several rooms open at once are otherwise hard to tell apart.
const age = (r: Room) => {
  const mins = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000)
  if (mins < 1) return 'just now'
  return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`
}

// A host closing the tab would otherwise strand an open room nobody can play
// in; deleting their row fires the schema trigger that closes it.
const onUnload = () => {
  if (store.room && store.playerId) leaveRoomOnUnload(store.room.id, store.playerId)
}

const run = async (fn: () => Promise<unknown>) => {
  busy.value = true
  try { await fn() } catch { /* surfaced via store.error */ } finally { busy.value = false }
}

const refresh = async () => { openRooms.value = await store.list() }

const signIn = () => run(async () => {
  await store.signIn(name.value || 'player')
  await refresh()
  watchRooms()
})

// nq_rooms and nq_room_players are both published to Realtime, so the list
// reflects hosts appearing and players joining without anyone hitting refresh.
const watchRooms = () => {
  if (unsubscribe) return
  unsubscribe = subscribeRooms(() => { void refresh() })
  live.value = true
}

const host = () => run(async () => {
  await store.host(roomName.value || `${store.playerName}'s game`, map.value)
})

const joinRoom = (r: Room) => run(() => store.joinRoom(r))
const joinByCode = () => run(() => store.join(code.value))
const leave = () => run(async () => { await store.leave(); await refresh() })

// Mirrors the legacy room flow: the host listens, everyone else dials the
// magic room address, which routes through the injected broker.
const launch = () => {
  const query: Record<string, string> = store.isHost
    ? { '-listen': '16', '+map': store.room!.map }
    : { '-connect': 'rtc://netquake.io/room' }
  router.push({ path: '/mp/quake', query })
}

onMounted(() => {
  window.addEventListener('beforeunload', onUnload)
  if (store.playerId) { void refresh(); watchRooms() }
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', onUnload)
  unsubscribe?.()
  unsubscribe = null
  live.value = false
})
</script>

<style lang="scss" scoped>
.sb-lobby { max-width: 760px; margin: 0 auto; padding: 32px 24px; }
.sub { opacity: 0.75; margin-bottom: 24px; }
.panel { border: 1px solid rgba(128,128,128,0.35); padding: 16px; margin-bottom: 16px; }
.panel h2 { margin: 0 0 12px; font-size: 1rem; text-transform: uppercase; display: flex; gap: 10px; align-items: center; }
.panel input, .panel select { margin-right: 8px; padding: 6px 8px; }
.panel.secondary { border-style: dashed; opacity: 0.85; }
.rooms li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid rgba(128,128,128,0.2); }
.rooms li:last-child { border-bottom: none; }
.who { display: flex; flex-direction: column; }
.live { font-size: 0.7rem; opacity: 0.6; text-transform: uppercase; }
.live.on { color: #5cb85c; opacity: 1; }
.err { color: #d9534f; }
.muted { opacity: 0.7; }
.code { letter-spacing: 3px; font-size: 1.2rem; }
.code-entry { margin-top: 10px; }
button { padding: 6px 14px; cursor: pointer; }
button.link { background: none; border: none; text-decoration: underline; padding: 0; }
ul { list-style: none; padding: 0; margin: 0; }
</style>
