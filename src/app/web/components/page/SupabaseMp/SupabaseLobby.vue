<template>
  <div class="sb-lobby">
    <h1>Peer-to-peer Multiplayer</h1>
    <p class="sub"><router-link to="/leaderboard">View the leaderboard</router-link></p>
    <p class="sub">
      Rooms and signaling run on Supabase. Once connected, game traffic goes
      direct between players and never passes through a server.
    </p>

    <p v-if="!store.available" class="err">
      Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
    </p>

    <template v-else>
      <p v-if="store.error" class="err">{{ store.error }}</p>
      <p v-if="store.playerId" class="muted whoami">
        Signed in as <strong>{{ store.playerName }}</strong>.
        <button class="link" :disabled="busy" @click="changeName">change name</button>
        <br />
        A second player must be a different account &mdash; use "change name"
        here, or a private window, or another browser.
      </p>
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
                <span class="tag game-tag">{{ r.game === "q2" ? "Quake 2" : "Quake 1" }}</span>
                <span class="muted">
                  {{ hostOf(r) }} &middot; {{ r.map }} &middot;
                  {{ count(r) }}/{{ r.max_players }} players &middot; {{ age(r) }}
                  <span v-if="r.status === 'in-game'" class="tag">in game</span>
                </span>
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
          <div class="radios">
            <label><input type="radio" value="q1" v-model="game" /> Quake 1</label>
            <label><input type="radio" value="q2" v-model="game" /> Quake 2</label>
          </div>
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

      <section v-else class="panel room">
        <h2>
          {{ store.room.name }}
          <span class="tag">{{ store.room.status === 'in-game' ? 'in game' : 'lobby' }}</span>
        </h2>
        <p class="muted">Code <strong class="code">{{ store.room.code }}</strong></p>

        <div class="cols">
          <div class="col">
            <h3>Players ({{ store.players.length }}/{{ store.room.max_players }})</h3>
            <ul class="players">
              <li v-for="p in store.players" :key="p.player_id">
                <span class="swatch" :style="{ background: colorHex(p.color) }"></span>
                <span class="pname">{{ nameOf(p) }}</span>
                <span v-if="p.is_host" class="tag">host</span>
                <span v-if="p.asset_progress < 100" class="muted">{{ p.asset_progress }}%</span>
                <template v-if="store.isHost && p.player_id !== store.playerId">
                  <button class="link" :disabled="busy" @click="kick(p.player_id)">kick</button>
                  <button class="link" :disabled="busy" @click="ban(p.player_id)">ban</button>
                </template>
              </li>
            </ul>

            <h3>Your colour</h3>
            <div class="colors">
              <button v-for="c in 14" :key="c" class="swatch pick"
                :class="{ on: myColor === c - 1 }"
                :style="{ background: colorHex(c - 1) }"
                @click="pickColor(c - 1)"></button>
            </div>

            <h3>Match settings</h3>
            <div v-if="store.isHost" class="settings">
              <label>Map
                <select v-model="settings.map" @change="saveSettings">
                  <option v-for="m in maps" :key="m" :value="m">{{ m }}</option>
                </select>
              </label>
              <label>Mode
                <span class="radios inline">
                  <label>
                    <input type="radio" value="deathmatch" v-model="settings.gameType"
                      @change="saveSettings" /> Deathmatch
                  </label>
                  <label>
                    <input type="radio" value="coop" v-model="settings.gameType"
                      @change="saveSettings" /> Co-op
                  </label>
                </span>
              </label>
              <label>Frag limit
                <input type="number" min="0" max="200" v-model.number="settings.fragLimit"
                  @change="saveSettings" />
              </label>
              <label>Time limit (min)
                <input type="number" min="0" max="120" v-model.number="settings.timeLimit"
                  @change="saveSettings" />
              </label>
              <label v-if="settings.gameType === 'coop'">Skill
                <select v-model.number="settings.skill" @change="saveSettings">
                  <option :value="0">Easy</option>
                  <option :value="1">Normal</option>
                  <option :value="2">Hard</option>
                  <option :value="3">Nightmare</option>
                </select>
              </label>
            </div>
            <p v-else class="muted">
              {{ store.room.map }} &middot; {{ settings.gameType }}
              &middot; frags {{ settings.fragLimit || '∞' }}
              &middot; time {{ settings.timeLimit || '∞' }}
            </p>
          </div>

          <div class="col">
            <h3>Chat</h3>
            <div class="chat" ref="chatBox">
              <p v-for="m in store.chat" :key="m.id" :class="m.kind">
                <template v-if="m.kind === 'event'">
                  <em>{{ chatName(m) }} {{ m.body }}</em>
                </template>
                <template v-else>
                  <strong>{{ chatName(m) }}:</strong> {{ m.body }}
                </template>
              </p>
              <p v-if="!store.chat.length" class="muted">No messages yet.</p>
            </div>
            <input v-model="chatDraft" maxlength="500" placeholder="say something"
              @keyup.enter="say" />
          </div>
        </div>

        <div class="actions">
          <button v-if="store.isHost" :disabled="busy" @click="launch">Start game</button>
          <button v-else :disabled="busy" @click="enterGame">Enter game</button>
          <button class="link" :disabled="busy" @click="leave">Leave</button>
        </div>
      </section>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useSupabaseRoomStore } from '../../../stores/supabaseRoom'
import { useGameStore } from '../../../stores/game'
import {
  Q1_SHAREWARE_MAPS,
  Q1_RETAIL_MAPS,
  Q1_LIBREQUAKE_MAPS,
  Q1_LIBREQUARTZ_MAPS,
  Q2_MAPS,
} from '../../../../../shared/quakeMaps'
import {
  playerCount, hostName, subscribeRooms, leaveRoomOnUnload,
  defaultGameSettings, hasExistingSession,
  type Room, type RoomPlayer, type ChatMessage, type GameId,
} from '../../../../../shared/supabase/rooms'

const router = useRouter()
const store = useSupabaseRoomStore()
const gameStore = useGameStore()


// Remembered between visits so a returning player is not re-asked for the same
// answers. Names only; nothing here identifies anyone across browsers.
const PREFS_KEY = 'netquake.lobby.prefs'
type Prefs = { name?: string, game?: GameId, map?: string }

const loadPrefs = (): Prefs => {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs }
  catch { return {} }
}

const savePrefs = (patch: Prefs): void => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch })) }
  catch { /* private mode, or storage full: preferences are not worth failing over */ }
}

const prefs = loadPrefs()
const name = ref(prefs.name ?? '')
const roomName = ref('')
const code = ref('')
const map = ref(prefs.map ?? 'e1m1')
const busy = ref(false)
const live = ref(false)
const showCode = ref(false)
const chatDraft = ref('')
const chatBox = ref<HTMLElement | null>(null)
const openRooms = ref<Room[]>([])
let unsubscribe: (() => void) | null = null

// Map lists live in shared/quakeMaps so the end-of-match vote can agree with
// this picker on exactly which maps exist.
const settings = reactive({ ...defaultGameSettings(), map: 'e1m1' })

const game = ref<GameId>(prefs.game ?? 'q1')

const hasPak1 = computed(() =>
  gameStore.assetMetas.some(a => a.game === 'id1' && a.fileName.toLowerCase() === 'pak1.pak')
)

const maps = computed<readonly string[]>(() => {
  if (game.value !== 'q1') return Q2_MAPS
  return [
    ...Q1_SHAREWARE_MAPS,
    ...(hasPak1.value ? Q1_RETAIL_MAPS : []),
    ...(settings.gameType === 'deathmatch'
      ? [...Q1_LIBREQUAKE_MAPS, ...Q1_LIBREQUARTZ_MAPS]
      : []),
  ]
})

// Switching engine must not leave an e1m1 selected for a Quake 2 room, which
// would create a room nobody can load. The same guard covers a remembered map
// that is no longer offered -- a returning player whose saved choice was a
// retail map they have since stopped supplying pak1 for.
watch(maps, (available) => {
  if (!available.includes(map.value)) map.value = available[0]
  // The in-room panel can change the mode after the map was chosen: switching a
  // room to co-op drops the LibreQuake maps, which only load under deathmatch.
  // Without this the room keeps a map nobody can load.
  if (store.room && store.isHost && !available.includes(settings.map)) {
    settings.map = available[0]
    void saveSettings()
  }
}, { immediate: true })

// Quake's 14 player colours, approximated for the lobby swatches.
const PALETTE = [
  '#d8d8d8', '#a86c34', '#5c78a8', '#3c6c3c', '#a83c3c', '#8c5c2c', '#a8a83c', '#6c3c8c',
  '#3c8c8c', '#c86c9c', '#5c5c5c', '#c8a86c', '#2c4c8c', '#8c2c2c',
]
const colorHex = (i: number) => PALETTE[i % PALETTE.length]


const count = (r: Room) => playerCount(r)
const hostOf = (r: Room) => hostName(r)
const nameOf = (p: RoomPlayer) => p.nq_profiles?.name ?? 'player'
const chatName = (m: ChatMessage) => m.nq_profiles?.name ?? 'someone'
const myColor = computed(() =>
  store.players.find((p: RoomPlayer) => p.player_id === store.playerId)?.color ?? 0)

const age = (r: Room) => {
  const mins = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000)
  if (mins < 1) return 'just now'
  return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`
}

const run = async (fn: () => Promise<unknown>) => {
  busy.value = true
  try { await fn() } catch { /* surfaced via store.error */ } finally { busy.value = false }
}


// Ends the session so this browser can sign in as someone else. The remembered
// name is cleared too, otherwise the auto sign-in would immediately restore the
// player that was just signed out.
const changeName = () => run(async () => {
  await store.signOut()
  savePrefs({ name: '' })
  name.value = ''
  openRooms.value = []
})
const refresh = async () => { openRooms.value = await store.list() }

const signIn = () => run(async () => {
  const chosen = name.value || 'player'
  await store.signIn(chosen)
  savePrefs({ name: chosen })
  // The header profile and the Quake 1 engine both read the name from autoexec.
  // Without this the lobby identity and the in-game name drift apart.
  if (gameStore.getAutoexecValue('name') !== chosen) {
    gameStore.setAutoexecValue({ name: 'name', value: chosen })
  }
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
  // The map must belong to the chosen game. The reset watcher runs on Vue's
  // next tick, so a fast switch-then-host can still be holding the previous
  // game's map here -- which would create a room nobody can load.
  const chosenMap = maps.value.includes(map.value) ? map.value : maps.value[0]
  map.value = chosenMap
  savePrefs({ game: game.value, map: chosenMap })
  await store.host(roomName.value || `${store.playerName}'s game`, chosenMap, game.value)
})

// Joining a match already in progress goes straight in: the status watcher only
// fires on the transition into 'in-game', so a late joiner would otherwise sit
// in the lobby watching a game they had already joined.
const enterIfRunning = () => { if (store.room?.status === 'in-game') enterGame() }
const joinRoom = (r: Room) => run(async () => { await store.joinRoom(r); enterIfRunning() })
const joinByCode = () => run(async () => { await store.join(code.value); enterIfRunning() })
const leave = () => run(async () => { await store.leave(); await refresh() })
const kick = (id: string) => run(() => store.kick(id))
const ban = (id: string) => run(() => store.ban(id))
const pickColor = (c: number) => run(() => store.setColor(c))
const saveSettings = () => run(() =>
  store.saveSettings({ ...settings }, settings.map))

const say = () => {
  const body = chatDraft.value
  chatDraft.value = ''
  void run(() => store.say(body))
}

// Engine command line. The host listens; everyone else dials the room address,
// which routes through the broker the app injected.
const gameQuery = (): Record<string, string> => {
  const s = store.room?.game_settings ?? defaultGameSettings()
  const me = store.players.find((p: RoomPlayer) => p.player_id === store.playerId)
  // _cl_color packs the two Quake colour slots as (top << 4) | bottom; the
  // lobby offers one swatch, so both slots get it.
  const c = me?.color ?? 0
  const rules: Record<string, string> = {
    '+fraglimit': String(s.fragLimit ?? 0),
    '+timelimit': String(s.timeLimit ?? 0),
    '+_cl_color': String((c << 4) | c),
    // The command line is space-joined and unquoted, so a name with spaces
    // would split into extra arguments.
    '+_cl_name': (store.playerName || 'player').replace(/\s+/g, '_'),
  }
  if (!store.isHost) return { '-connect': 'rtc://netquake.io/room', ...rules }
  return {
    '-listen': String(store.room?.max_players ?? 8),
    '+map': store.room?.map ?? 'e1m1',
    ...(s.gameType === 'coop'
      ? { '+coop': '1', '+skill': String(s.skill ?? 1) }
      : { '+deathmatch': '1' }),
    ...rules,
  }
}

// Quake 2 is a separate application mounted at /q2/, not a Vue route, so
// entering one leaves the router entirely and hands the session over in the URL.
const enterGame = () => {
  const room = store.room
  if (room?.game === 'q2') {
    const q = new URLSearchParams({
      room: room.id,
      player: store.playerId ?? '',
      host: store.isHost ? '1' : '0',
      map: room.map,
      max: String(room.max_players),
      // Quake 2 keeps its own name cvar; without this it plays as the default.
      name: (store.playerName || 'player').replace(/\s+/g, '_'),
    })
    leavingForGame = true
    window.location.href = `${import.meta.env.BASE_URL}q2/?${q.toString()}`
    return
  }
  router.push({ path: '/mp/quake', query: gameQuery() })
}

// Host flips the room to in-game; the watcher below carries everyone in,
// including the host, so nobody has to press Start for themselves.
const launch = () => run(() => store.launch())

// Set just before a deliberate navigation into the game. Entering a Quake 2
// match is a full page load, which fires beforeunload -- and the cleanup below
// would then delete the host's row, which the schema trigger takes as the host
// leaving and closes the room the instant it launches.
let leavingForGame = false

const onUnload = () => {
  if (leavingForGame) return
  if (store.room && store.playerId) leaveRoomOnUnload(store.room.id, store.playerId)
}

// The launch signal. Everyone in the room -- host included -- follows the room
// row into the game, so the match starts together instead of one player at a
// time. Guarded so it only fires on the transition into 'in-game'.
watch(() => store.room?.status, (now, before) => {
  if (now === 'in-game' && before && before !== 'in-game') {
    enterGame()
  }
})

// Keep the host's settings form in step with whatever the room actually holds,
// so a second browser editing them does not get clobbered.
watch(() => store.room?.game_settings, (s) => {
  if (s) Object.assign(settings, s)
}, { immediate: true, deep: true })

watch(() => store.room?.map, (m) => { if (m) settings.map = m }, { immediate: true })

watch(() => store.chat.length, async () => {
  await nextTick()
  if (chatBox.value) chatBox.value.scrollTop = chatBox.value.scrollHeight
})

onMounted(() => {
  window.addEventListener('beforeunload', onUnload)
  if (store.playerId) { void refresh(); watchRooms(); return }
  // A returning player already has a session in this browser, so re-asking for
  // a name adds a step and nothing else. Only auto sign-in when a session
  // exists: otherwise merely opening the page would mint an anonymous user.
  void (async () => {
    if (!store.available || !prefs.name) return
    if (!(await hasExistingSession())) return
    await run(async () => {
      await store.signIn(prefs.name as string)
      await refresh()
      watchRooms()
    })
  })()
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', onUnload)
  unsubscribe?.()
  unsubscribe = null
  live.value = false
})
</script>

<style lang="scss" scoped>
.sb-lobby { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
.sub { opacity: 0.75; margin-bottom: 24px; }
.panel { border: 1px solid rgba(128,128,128,0.35); padding: 16px; margin-bottom: 16px; }
.panel h2 { margin: 0 0 12px; font-size: 1rem; text-transform: uppercase; display: flex; gap: 10px; align-items: center; }
.panel h3 { margin: 18px 0 8px; font-size: 0.8rem; text-transform: uppercase; opacity: 0.8; }
.panel input, .panel select { margin-right: 8px; padding: 6px 8px; }
.panel.secondary { border-style: dashed; opacity: 0.85; }
.rooms li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid rgba(128,128,128,0.2); }
.rooms li:last-child { border-bottom: none; }
.who { display: flex; flex-direction: column; }
.cols { display: flex; gap: 24px; flex-wrap: wrap; }
.col { flex: 1 1 320px; min-width: 0; }
.players { list-style: none; padding: 0; margin: 0; }
.players li { display: flex; align-items: center; gap: 8px; padding: 5px 0; }
.pname { font-weight: 600; }
.swatch { width: 14px; height: 14px; border-radius: 3px; display: inline-block; border: 1px solid rgba(0,0,0,0.4); }
.swatch.pick { width: 20px; height: 20px; cursor: pointer; padding: 0; }
.swatch.pick.on { outline: 2px solid #d9534f; outline-offset: 2px; }
.colors { display: flex; gap: 6px; flex-wrap: wrap; }
.settings { display: flex; flex-direction: column; gap: 8px; }
.settings label { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.settings input { width: 90px; }
.chat { height: 220px; overflow-y: auto; border: 1px solid rgba(128,128,128,0.25); padding: 8px; margin-bottom: 8px; }
.chat p { margin: 0 0 4px; font-size: 0.9rem; }
.chat p.event { opacity: 0.65; }
.actions { margin-top: 18px; display: flex; gap: 10px; align-items: center; }
.tag { font-size: 0.7rem; text-transform: uppercase; opacity: 0.7; border: 1px solid currentColor; padding: 0 5px; border-radius: 3px; }
.live { font-size: 0.7rem; opacity: 0.6; text-transform: uppercase; }
.live.on { color: #5cb85c; opacity: 1; }
.err { color: #d9534f; }
.muted { opacity: 0.7; }
.code { letter-spacing: 3px; font-size: 1.2rem; }
.code-entry { margin-top: 10px; }
button { padding: 6px 14px; cursor: pointer; }
button.link { background: none; border: none; text-decoration: underline; padding: 0 4px; }
ul { list-style: none; padding: 0; margin: 0; }
.radios { display: flex; gap: 14px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
.radios.inline { margin: 0; display: inline-flex; }
.radios label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.radios input { margin: 0; }
/* Native dropdown popups render on a light background, so the inherited grey
   was washed out and hard to read. */
select, select option { color: #111; background: #fff; }
select { border: 1px solid rgba(0, 0, 0, 0.35); }
/* Same reasoning as the dropdowns: these render on a light field, where the
   inherited grey was washed out. Placeholders stay lighter, but readable. */
.sb-lobby input[type="text"],
.sb-lobby input[type="number"],
.sb-lobby input:not([type]) {
  color: #111;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.35);
}
.sb-lobby input::placeholder { color: #444; opacity: 1; }
</style>
