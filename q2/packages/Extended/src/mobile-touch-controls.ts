/**
 * File: mobile-touch-controls.ts
 * Purpose: Browser-only mobile controls kept outside the source-port packages.
 */

export interface MobileTouchControlsOptions {
  root: HTMLElement;
  isGameplayActive: () => boolean;
  isMenuActive: () => boolean;
  getTime: () => number;
  addCommandText: (text: string) => void;
  applyLookDelta: (movementX: number, movementY: number) => void;
  pressMenuKey: (key: number) => void;
  menuKeys: {
    up: number;
    down: number;
    left: number;
    right: number;
    enter: number;
    escape: number;
  };
  onInteract?: () => void;
}

export interface MobileTouchControls {
  update: () => void;
  dispose: () => void;
}

type MoveAction = "forward" | "back" | "moveleft" | "moveright";
type HoldAction = MoveAction | "attack" | "moveup" | "movedown";

interface HoldBinding {
  command: HoldAction;
  key: number;
  held: boolean;
}

const HOLD_KEYS: Record<HoldAction, number> = {
  forward: -701,
  back: -702,
  moveleft: -703,
  moveright: -704,
  attack: -705,
  moveup: -706,
  movedown: -707
};

const MOVE_ACTIONS: MoveAction[] = ["forward", "back", "moveleft", "moveright"];
const DEFAULT_LOOK_SCALE = 3.2;

export function attachMobileTouchControls(options: MobileTouchControlsOptions): MobileTouchControls {
  const style = document.createElement("style");
  style.textContent = MOBILE_TOUCH_CONTROLS_CSS;

  const overlay = document.createElement("div");
  overlay.className = "q2ext-touch";
  overlay.setAttribute("aria-hidden", "true");

  const lookPad = document.createElement("div");
  lookPad.className = "q2ext-touch__look";

  const stick = document.createElement("div");
  stick.className = "q2ext-touch__stick";
  const stickKnob = document.createElement("div");
  stickKnob.className = "q2ext-touch__stick-knob";
  stick.append(stickKnob);

  const buttons = document.createElement("div");
  buttons.className = "q2ext-touch__buttons";
  buttons.append(
    createHoldButton("TIR", "attack", options),
    createHoldButton("SAUT", "moveup", options),
    createHoldButton("BAS", "movedown", options),
    createTapButton("W-", "cmd weapprev", options),
    createTapButton("W+", "cmd weapnext", options)
  );

  const menu = document.createElement("div");
  menu.className = "q2ext-touch__menu";
  menu.append(
    createMenuButton("HAUT", options.menuKeys.up, options),
    createMenuButton("OK", options.menuKeys.enter, options),
    createMenuButton("BAS", options.menuKeys.down, options),
    createMenuButton("GAUCHE", options.menuKeys.left, options),
    createMenuButton("RETOUR", options.menuKeys.escape, options),
    createMenuButton("DROITE", options.menuKeys.right, options)
  );

  overlay.append(lookPad, stick, buttons, menu);
  document.head.append(style);
  options.root.append(overlay);

  const movement = createMovementStick(stick, stickKnob, options);
  const look = createLookPad(lookPad, options);

  const update = (): void => {
    const mobileEnabled = shouldShowMobileControls();
    const gameplayVisible = mobileEnabled && options.isGameplayActive();
    const menuVisible = mobileEnabled && !gameplayVisible && options.isMenuActive();
    const visible = gameplayVisible || menuVisible;
    overlay.classList.toggle("q2ext-touch--visible", visible);
    overlay.classList.toggle("q2ext-touch--game", gameplayVisible);
    overlay.classList.toggle("q2ext-touch--menu", menuVisible);
    if (!gameplayVisible) {
      movement.releaseAll();
      releaseAllButtonHolds(options);
    }
  };

  update();
  return {
    update,
    dispose: () => {
      movement.releaseAll();
      releaseAllButtonHolds(options);
      look.dispose();
      overlay.remove();
      style.remove();
    }
  };
}

function createMovementStick(
  stick: HTMLElement,
  knob: HTMLElement,
  options: MobileTouchControlsOptions
): { releaseAll: () => void } {
  const center = { x: 0, y: 0 };
  let activePointer: number | null = null;

  const onPointerDown = (event: PointerEvent): void => {
    if (!options.isGameplayActive()) {
      return;
    }

    event.preventDefault();
    options.onInteract?.();
    activePointer = event.pointerId;
    stick.setPointerCapture(event.pointerId);
    const bounds = stick.getBoundingClientRect();
    center.x = bounds.left + bounds.width / 2;
    center.y = bounds.top + bounds.height / 2;
    updateStick(event.clientX, event.clientY);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointer) {
      return;
    }
    event.preventDefault();
    updateStick(event.clientX, event.clientY);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== activePointer) {
      return;
    }
    event.preventDefault();
    activePointer = null;
    resetStick();
  };

  const updateStick = (clientX: number, clientY: number): void => {
    const radius = Math.max(32, stick.clientWidth * 0.34);
    const dx = clamp(clientX - center.x, -radius, radius);
    const dy = clamp(clientY - center.y, -radius, radius);
    knob.style.transform = `translate(${dx}px, ${dy}px)`;

    setHold(options, "forward", dy < -radius * 0.28);
    setHold(options, "back", dy > radius * 0.28);
    setHold(options, "moveleft", dx < -radius * 0.28);
    setHold(options, "moveright", dx > radius * 0.28);
  };

  const resetStick = (): void => {
    knob.style.transform = "translate(0, 0)";
    for (const action of MOVE_ACTIONS) {
      setHold(options, action, false);
    }
  };

  stick.addEventListener("pointerdown", onPointerDown);
  stick.addEventListener("pointermove", onPointerMove);
  stick.addEventListener("pointerup", onPointerUp);
  stick.addEventListener("pointercancel", onPointerUp);

  return { releaseAll: resetStick };
}

function createLookPad(
  lookPad: HTMLElement,
  options: MobileTouchControlsOptions
): { dispose: () => void } {
  let activePointer: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (event: PointerEvent): void => {
    if (!options.isGameplayActive()) {
      return;
    }
    event.preventDefault();
    options.onInteract?.();
    activePointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    lookPad.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointer) {
      return;
    }
    event.preventDefault();
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    const lookScale = readLookScale();
    options.applyLookDelta(dx * lookScale, dy * lookScale);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === activePointer) {
      event.preventDefault();
      activePointer = null;
    }
  };

  lookPad.addEventListener("pointerdown", onPointerDown);
  lookPad.addEventListener("pointermove", onPointerMove);
  lookPad.addEventListener("pointerup", onPointerUp);
  lookPad.addEventListener("pointercancel", onPointerUp);

  return {
    dispose: () => {
      activePointer = null;
    }
  };
}

function createHoldButton(label: string, command: HoldAction, options: MobileTouchControlsOptions): HTMLButtonElement {
  const button = createButton(label);

  const hold = (event: PointerEvent): void => {
    if (!options.isGameplayActive()) {
      return;
    }
    event.preventDefault();
    options.onInteract?.();
    button.setPointerCapture(event.pointerId);
    setHold(options, command, true);
  };

  const release = (event: PointerEvent): void => {
    event.preventDefault();
    setHold(options, command, false);
  };

  button.addEventListener("pointerdown", hold);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", () => setHold(options, command, false));
  return button;
}

function createTapButton(label: string, command: string, options: MobileTouchControlsOptions): HTMLButtonElement {
  const button = createButton(label);
  button.addEventListener("pointerdown", (event) => {
    if (!options.isGameplayActive()) {
      return;
    }
    event.preventDefault();
    options.onInteract?.();
    options.addCommandText(`${command}\n`);
  });
  return button;
}

function createMenuButton(label: string, key: number, options: MobileTouchControlsOptions): HTMLButtonElement {
  const button = createButton(label);
  button.addEventListener("pointerdown", (event) => {
    if (!options.isMenuActive()) {
      return;
    }
    event.preventDefault();
    options.onInteract?.();
    options.pressMenuKey(key);
  });
  return button;
}

function createButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "q2ext-touch__button";
  button.type = "button";
  button.textContent = label;
  return button;
}

const heldButtons = new Map<MobileTouchControlsOptions, Map<HoldAction, HoldBinding>>();

function setHold(options: MobileTouchControlsOptions, command: HoldAction, held: boolean): void {
  const binding = getHoldBinding(options, command);
  if (binding.held === held) {
    return;
  }

  binding.held = held;
  const prefix = held ? "+" : "-";
  options.addCommandText(`${prefix}${command} ${binding.key} ${Math.trunc(options.getTime())}\n`);
}

function getHoldBinding(options: MobileTouchControlsOptions, command: HoldAction): HoldBinding {
  let bindings = heldButtons.get(options);
  if (!bindings) {
    bindings = new Map();
    heldButtons.set(options, bindings);
  }

  let binding = bindings.get(command);
  if (!binding) {
    binding = { command, key: HOLD_KEYS[command], held: false };
    bindings.set(command, binding);
  }

  return binding;
}

function releaseAllButtonHolds(options: MobileTouchControlsOptions): void {
  const bindings = heldButtons.get(options);
  if (!bindings) {
    return;
  }

  for (const binding of bindings.values()) {
    if (binding.held) {
      setHold(options, binding.command, false);
    }
  }
}

function shouldShowMobileControls(): boolean {
  return window.localStorage.getItem("q2jsMobileControls") === "1"
    || new URLSearchParams(window.location.search).get("touch") === "1"
    || window.matchMedia("(pointer: coarse)").matches
    || navigator.maxTouchPoints > 0;
}

function readLookScale(): number {
  const configured = Number.parseFloat(window.localStorage.getItem("q2jsTouchLookScale") ?? "");
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LOOK_SCALE;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const MOBILE_TOUCH_CONTROLS_CSS = `
.q2ext-touch {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: none;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  pointer-events: none;
  font-family: Arial, Helvetica, sans-serif;
}

.q2ext-touch--visible {
  display: block;
}

.q2ext-touch--menu .q2ext-touch__look,
.q2ext-touch--menu .q2ext-touch__stick,
.q2ext-touch--menu .q2ext-touch__buttons,
.q2ext-touch__menu {
  display: none;
}

.q2ext-touch--menu .q2ext-touch__menu {
  display: grid;
}

.q2ext-touch__look {
  position: absolute;
  inset: 0 0 0 42%;
  pointer-events: auto;
}

.q2ext-touch__stick {
  position: absolute;
  left: max(18px, env(safe-area-inset-left));
  bottom: max(24px, env(safe-area-inset-bottom));
  width: clamp(118px, 26vw, 168px);
  aspect-ratio: 1;
  border-radius: 50%;
  border: 2px solid rgba(240, 224, 194, 0.36);
  background: rgba(8, 10, 12, 0.34);
  pointer-events: auto;
}

.q2ext-touch__stick-knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 44%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: rgba(242, 222, 176, 0.46);
  border: 1px solid rgba(255, 246, 220, 0.68);
  transform: translate(0, 0);
  translate: -50% -50%;
}

.q2ext-touch__buttons {
  position: absolute;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(20px, env(safe-area-inset-bottom));
  display: grid;
  grid-template-columns: repeat(2, clamp(58px, 13vw, 74px));
  gap: 10px;
  pointer-events: auto;
}

.q2ext-touch__button {
  min-width: 0;
  height: clamp(52px, 12vw, 68px);
  border: 1px solid rgba(255, 238, 194, 0.52);
  border-radius: 8px;
  color: #fff2ce;
  background: rgba(13, 15, 18, 0.58);
  font: 700 13px/1 Arial, Helvetica, sans-serif;
  letter-spacing: 0;
  text-align: center;
  touch-action: none;
}

.q2ext-touch__button:active {
  background: rgba(151, 44, 28, 0.78);
  border-color: rgba(255, 230, 179, 0.88);
}

.q2ext-touch__menu {
  position: absolute;
  left: 50%;
  bottom: max(22px, env(safe-area-inset-bottom));
  grid-template-columns: repeat(3, clamp(74px, 18vw, 98px));
  gap: 10px;
  transform: translateX(-50%);
  pointer-events: auto;
}
`;
