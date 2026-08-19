<template>
  <div class="touch-controls">

    <!-- Left zone: D-pad movement -->
    <div class="touch-zone touch-zone-left">
      <div
        class="dpad"
        @touchstart.prevent="onDpadStart"
        @touchmove.prevent="onDpadMove"
        @touchend.prevent="onDpadEnd"
        @touchcancel.prevent="onDpadEnd"
      >
        <button class="dpad-btn dpad-up">▲</button>
        <button class="dpad-btn dpad-left">◀</button>
        <div class="dpad-center"></div>
        <button class="dpad-btn dpad-right">▶</button>
        <button class="dpad-btn dpad-down">▼</button>
      </div>
    </div>

    <!-- Right zone: joystick aim + fire + jump + weapons -->
    <div
      ref="rightZone"
      class="touch-zone touch-zone-right"
      @touchstart.prevent="onAimStart"
      @touchmove.prevent="onAimMove"
      @touchend.prevent="onAimEnd"
      @touchcancel.prevent="onAimEnd"
    >
      <!-- Aim joystick visual -->
      <div v-if="aim.active" class="joy-ring" :style="aimRingStyle">
        <div class="joy-dot" :style="aimDotStyle"></div>
      </div>

      <!-- Weapon cycle -->
      <button
        class="touch-btn touch-btn-prevweapon"
        @touchstart.stop.prevent="onPrevWeapon"
      >&#x276E;</button>
      <button
        class="touch-btn touch-btn-nextweapon"
        @touchstart.stop.prevent="onNextWeapon"
      >&#x276F;</button>

      <!-- Fire (also acts as Enter in menus) -->
      <button
        class="touch-btn touch-btn-fire"
        @touchstart.stop.prevent="onFireDown"
        @touchend.stop.prevent="onFireUp"
        @touchcancel.stop.prevent="onFireUp"
      >&#x25CF;</button>
      <button
        class="touch-btn touch-btn-jump"
        @touchstart.stop.prevent="onJumpDown"
        @touchend.stop.prevent="onJumpUp"
        @touchcancel.stop.prevent="onJumpUp"
      >&#x25B2;</button>
    </div>

    <!-- Menu button — floats above both zones -->
    <button
      class="touch-btn touch-btn-menu"
      @touchstart.stop.prevent="onMenuTap"
    >&#x2630;</button>

  </div>
</template>

<script lang="ts" setup>
import { reactive, computed, ref } from 'vue'

const props = defineProps<{
  gameSys: {
    queueCommand: (cmd: string) => void
    sendMouseDelta: (x: number, y: number) => void
    sendKeyEvent: (keyCode: number, down: boolean) => Promise<void>
    getKeyDest: () => number
    TOUCH_KEYS: {
      uparrow: number; downarrow: number; leftarrow: number; rightarrow: number
      enter: number; escape: number; mwheelup: number; mwheeldown: number
    }
    KEY_DEST_MENU: number
  }
}>()

const AIM_RADIUS = 60
// Applied per animation frame per pixel of joystick deflection.
// At max 60px deflection this gives ~108°/s at default Quake sensitivity.
const LOOK_SPEED = 0.3

const rightZone = ref<HTMLElement | null>(null)

// Aim joystick state
const aim = reactive({
  active: false,
  touchId: -1,
  centerX: 0,
  centerY: 0,
  dx: 0,
  dy: 0,
})

let aimRafId: number | null = null

function startAimLoop() {
  if (aimRafId !== null) return
  const tick = () => {
    if (!aim.active) { aimRafId = null; return }
    if (aim.dx !== 0 || aim.dy !== 0) {
      props.gameSys.sendMouseDelta(aim.dx * LOOK_SPEED, aim.dy * LOOK_SPEED)
    }
    aimRafId = requestAnimationFrame(tick)
  }
  aimRafId = requestAnimationFrame(tick)
}

function stopAimLoop() {
  if (aimRafId !== null) { cancelAnimationFrame(aimRafId); aimRafId = null }
}

// Track which movement directions are currently held
const activeDirections = new Set<string>()

// D-pad direction → { moveCmd, arrowKey }
const DPAD_MAP = {
  forward:   { cmd: 'forward',   key: 'uparrow'   },
  back:      { cmd: 'back',      key: 'downarrow'  },
  moveleft:  { cmd: 'moveleft',  key: 'leftarrow'  },
  moveright: { cmd: 'moveright', key: 'rightarrow' },
} as const

// Per-touch identifier → which dpad direction it is currently pressing
const dpadTouches = new Map<number, keyof typeof DPAD_MAP | null>()

const aimRingStyle = computed(() => ({
  left: aim.centerX - AIM_RADIUS + 'px',
  top: aim.centerY - AIM_RADIUS + 'px',
}))

const aimDotStyle = computed(() => ({
  transform: `translate(${aim.dx}px, ${aim.dy}px)`,
}))

// --- D-pad helpers ---

function inMenu(): boolean {
  return props.gameSys.getKeyDest() === props.gameSys.KEY_DEST_MENU
}

function pressDir(dir: keyof typeof DPAD_MAP) {
  if (inMenu()) {
    props.gameSys.sendKeyEvent(props.gameSys.TOUCH_KEYS[DPAD_MAP[dir].key], true)
    return
  }
  if (!activeDirections.has(dir)) {
    activeDirections.add(dir)
    props.gameSys.queueCommand('+' + DPAD_MAP[dir].cmd)
  }
}

function releaseDir(dir: keyof typeof DPAD_MAP) {
  if (inMenu()) {
    props.gameSys.sendKeyEvent(props.gameSys.TOUCH_KEYS[DPAD_MAP[dir].key], false)
    return
  }
  if (activeDirections.has(dir)) {
    activeDirections.delete(dir)
    props.gameSys.queueCommand('-' + DPAD_MAP[dir].cmd)
  }
}

function getDpadDirAt(x: number, y: number): keyof typeof DPAD_MAP | null {
  const el = document.elementFromPoint(x, y)
  if (!el) return null
  if (el.classList.contains('dpad-up'))    return 'forward'
  if (el.classList.contains('dpad-down'))  return 'back'
  if (el.classList.contains('dpad-left'))  return 'moveleft'
  if (el.classList.contains('dpad-right')) return 'moveright'
  return null
}

function onDpadStart(e: TouchEvent) {
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i]
    const dir = getDpadDirAt(t.clientX, t.clientY)
    dpadTouches.set(t.identifier, dir)
    if (dir) pressDir(dir)
  }
}

function onDpadMove(e: TouchEvent) {
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i]
    const newDir = getDpadDirAt(t.clientX, t.clientY)
    const prevDir = dpadTouches.get(t.identifier)
    if (newDir !== prevDir) {
      if (prevDir) releaseDir(prevDir)
      if (newDir) pressDir(newDir)
      dpadTouches.set(t.identifier, newDir)
    }
  }
}

function onDpadEnd(e: TouchEvent) {
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i]
    const dir = dpadTouches.get(t.identifier)
    if (dir) releaseDir(dir)
    dpadTouches.delete(t.identifier)
  }
}

// --- Aim joystick handlers ---

function onAimStart(e: TouchEvent) {
  if (aim.active) return
  const t = e.changedTouches[0]
  const rect = rightZone.value?.getBoundingClientRect()
  const ox = rect ? rect.left : 0
  const oy = rect ? rect.top : 0
  aim.active = true
  aim.touchId = t.identifier
  aim.centerX = t.clientX - ox
  aim.centerY = t.clientY - oy
  aim.dx = 0
  aim.dy = 0
  startAimLoop()
}

function onAimMove(e: TouchEvent) {
  if (!aim.active) return
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i]
    if (t.identifier !== aim.touchId) continue

    // Update joystick offset (zone-relative), clamped to radius
    const rect = rightZone.value?.getBoundingClientRect()
    const ox = rect ? rect.left : 0
    const oy = rect ? rect.top : 0
    let vdx = (t.clientX - ox) - aim.centerX
    let vdy = (t.clientY - oy) - aim.centerY
    const dist = Math.sqrt(vdx * vdx + vdy * vdy)
    if (dist > AIM_RADIUS) {
      vdx = (vdx / dist) * AIM_RADIUS
      vdy = (vdy / dist) * AIM_RADIUS
    }
    aim.dx = vdx
    aim.dy = vdy
  }
}

function onAimEnd(e: TouchEvent) {
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === aim.touchId) {
      aim.active = false
      aim.touchId = -1
      aim.dx = 0
      aim.dy = 0
      stopAimLoop()
      break
    }
  }
}

// --- Button handlers ---

// Fire doubles as menu-select (Enter) when a menu is open
async function onFireDown() {
  if (inMenu()) await props.gameSys.sendKeyEvent(props.gameSys.TOUCH_KEYS.enter, true)
  else props.gameSys.queueCommand('+attack')
}
async function onFireUp() {
  if (inMenu()) await props.gameSys.sendKeyEvent(props.gameSys.TOUCH_KEYS.enter, false)
  else props.gameSys.queueCommand('-attack')
}

async function onJumpDown() {
  if (inMenu()) await props.gameSys.sendKeyEvent(props.gameSys.TOUCH_KEYS.escape, true)
  else props.gameSys.queueCommand('+jump')
}
async function onJumpUp() {
  if (inMenu()) await props.gameSys.sendKeyEvent(props.gameSys.TOUCH_KEYS.escape, false)
  else props.gameSys.queueCommand('-jump')
}

// Weapon cycling — impulse 10/12 are standard Quake next/prev weapon
function onNextWeapon() { props.gameSys.queueCommand('impulse 10') }
function onPrevWeapon() { props.gameSys.queueCommand('impulse 12') }

// Menu — ESC opens/closes/goes back; sends a quick press+release
async function onMenuTap() {
  await props.gameSys.sendKeyEvent(props.gameSys.TOUCH_KEYS.escape, true)
  await props.gameSys.sendKeyEvent(props.gameSys.TOUCH_KEYS.escape, false)
}
</script>

<style scoped>
.touch-controls {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
}

.touch-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: auto;
}

.touch-zone-left {
  left: 0;
  width: 50%;
}

.touch-zone-right {
  right: 0;
  width: 50%;
}

/* ---- D-pad ---- */
.dpad {
  position: absolute;
  bottom: 24px;
  left: 24px;
  width: 174px;
  height: 174px;
  display: grid;
  grid-template-columns: 54px 54px 54px;
  grid-template-rows: 54px 54px 54px;
  gap: 6px;
}

.dpad-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.75);
  font-size: 20px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  pointer-events: auto;
  /* tap highlight off */
  -webkit-tap-highlight-color: transparent;
}

.dpad-btn:active {
  background: rgba(255, 255, 255, 0.35);
}

/* Grid placement: row / col (1-indexed) */
.dpad-up    { grid-column: 2; grid-row: 1; }
.dpad-left  { grid-column: 1; grid-row: 2; }
.dpad-center{ grid-column: 2; grid-row: 2; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; }
.dpad-right { grid-column: 3; grid-row: 2; }
.dpad-down  { grid-column: 2; grid-row: 3; }

/* ---- Aim joystick visual ---- */
.joy-ring {
  position: absolute;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.joy-dot {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.45);
  pointer-events: none;
}

/* ---- Action buttons ---- */
.touch-btn {
  position: absolute;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.75);
  font-size: 18px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  pointer-events: auto;
}

.touch-btn-fire {
  width: 64px;
  height: 64px;
  bottom: 40px;
  right: 100px;
  background: rgba(220, 40, 40, 0.4);
}

.touch-btn-jump {
  width: 52px;
  height: 52px;
  bottom: 48px;
  right: 20px;
  background: rgba(255, 255, 255, 0.2);
}

.touch-btn-prevweapon {
  width: 48px;
  height: 48px;
  bottom: 120px;
  right: 110px;
  background: rgba(255, 255, 255, 0.15);
  font-size: 22px;
}

.touch-btn-nextweapon {
  width: 48px;
  height: 48px;
  bottom: 120px;
  right: 50px;
  background: rgba(255, 255, 255, 0.15);
  font-size: 22px;
}

/* Menu button sits outside both zones at top-right of the overlay */
.touch-btn-menu {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.8);
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
</style>
