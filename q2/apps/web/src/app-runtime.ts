/**
 * File: app-runtime.ts
 * Purpose: Browser page that follows the original Quake II front-door flow: cinematics first, then the menu.
 *
 * This file is not a direct source port.
 * It is an application adapter that wires ported client/menu/cinematic code to a canvas-backed web page.
 *
 * Dependencies:
 * - packages/client
 * - packages/filesystem
 * - packages/formats
 * - packages/qcommon
 */

import { parseBsp, parsePcx, type PcxImage } from "../../../packages/formats/src/index.js";
import { Scene } from "three";
import {
  createVirtualFilesystem,
  FS_AddGameDirectory,
  FS_Gamedir,
  FS_ListFiles,
  FS_LoadFile,
  FS_NextPath,
  FS_SetGamedir,
  readMountedFile,
  type VirtualFilesystem
} from "../../../packages/filesystem/src/index.js";
import {
  createQuakeWebAudioAdapter,
  createWebCDAudioAdapter,
  type QuakeWebAudioAdapter,
  type WebCDAudioAdapter
} from "../../../packages/platform/src/index.js";
import {
  Cmd_AddCommand,
  Cmd_Exists,
  Cmd_Init,
  Cmd_RemoveCommand,
  Cbuf_AddText,
  Cbuf_Execute,
  CVAR_ARCHIVE,
  Cvar_Command,
  Cvar_Init,
  Cvar_Get,
  Cvar_Set as QcommonCvar_Set,
  Cvar_SetValue as QcommonCvar_SetValue,
  Cvar_VariableValue,
  COM_Parse,
  CS_ITEMS,
  Com_BlockChecksum,
  MAX_ITEMS,
  PRINT_ALL,
  PROTOCOL_VERSION,
  Qcommon_Frame,
  Qcommon_Init,
  Qcommon_Shutdown,
  Sys_AppActivate,
  AngleVectors,
  svc_ops_e,
  CM_InlineModel,
  createCommandRuntime,
  createQcommonGlobals,
  createQcommonHostRuntime,
  createQcommonMiscRuntime,
  createCvarRuntime,
  type QcommonHostRuntime,
  type QcommonMiscRuntime,
  type cvar_t,
  type netadr_t
} from "../../../packages/qcommon/src/index.js";
import {
  K_DOWNARROW,
  K_BACKSPACE,
  K_ALT,
  K_CTRL,
  K_DEL,
  K_ENTER,
  K_ESCAPE,
  K_F10,
  K_END,
  K_F1,
  K_HOME,
  K_INS,
  K_KP_DOWNARROW,
  K_KP_END,
  K_KP_ENTER,
  K_KP_DEL,
  K_KP_HOME,
  K_KP_INS,
  K_KP_LEFTARROW,
  K_KP_MINUS,
  K_KP_PGDN,
  K_KP_PGUP,
  K_KP_PLUS,
  K_KP_RIGHTARROW,
  K_KP_SLASH,
  K_KP_UPARROW,
  K_LEFTARROW,
  K_MWHEELDOWN,
  K_MWHEELUP,
  K_MOUSE1,
  K_MOUSE2,
  K_MOUSE3,
  K_RIGHTARROW,
  K_PGUP,
  K_PGDN,
  K_PAUSE,
  K_SHIFT,
  K_SPACE,
  K_TAB,
  K_UPARROW,
  Key_Init,
  Key_Event,
  Key_KeynumToString,
  createClientKeyContext,
  keydest_t
} from "../../../packages/client/src/keys.js";
import {
  Con_ClearNotify,
  Con_DrawConsole,
  Con_Init,
  Con_Print,
  Con_SyncConsoleToKeys,
  Con_ToggleConsole_f,
  createClientConsoleContext,
  type ClientConsoleContext,
  type ConsoleDrawConsoleSnapshot,
  type ConsoleTextCommand
} from "../../../packages/client/src/console.js";
import {
  M_Draw,
  M_ForceMenuOff,
  M_Init,
  M_Keydown,
  M_AddToServerList,
  M_Menu_Main_f,
  NUM_CURSOR_FRAMES,
  createClientMenuContext,
  type ClientMenuContext,
  type ClientMenuMapEntry,
  type PlayerModelInfo
} from "../../../packages/client/src/menu.js";
import { createClientQMenuContext, Menu_Center, type menuframework_s } from "../../../packages/client/src/qmenu.js";
import {
  SCR_DrawCinematicRef,
  SCR_DrawLoading,
} from "../../../packages/client/src/cl_scrn.js";
import {
  SCR_Init,
  SCR_EndLoadingPlaque,
  SCR_FinishCinematic,
  SCR_PlayCinematic,
  SCR_RunCinematic,
  SCR_RunConsole,
  SCR_StopCinematic
} from "../../../packages/client/src/screen.js";
import type { ClientHudPictureCommand } from "../../../packages/client/src/cl_scrn.js";
import type { ClientScreenHooks } from "../../../packages/client/src/cl_cin.js";
import { CL_RegisterSounds } from "../../../packages/client/src/sound-registration.js";
import type {
  ClientParseHooks,
  ClientMuzzleFlash2Packet,
  ClientMuzzleFlashPacket,
  ClientTempEntityPacket
} from "../../../packages/client/src/cl_parse.js";
import type { ClientEntityEvent } from "../../../packages/client/src/cl_ents.js";
import { CL_InitInput, createClientInputContext, createClientSendCmdBridge } from "../../../packages/client/src/cl_input.js";
import {
  IN_Activate,
  IN_Shutdown,
  createClientInputDeviceContext,
  createClientInputDeviceMainHooks,
  type ClientInputDeviceContext
} from "../../../packages/client/src/input.js";
import {
  CL_Frame,
  CL_InitLocal,
  CL_ReadPackets,
  CL_Shutdown,
  CL_WriteConfiguration,
  Cmd_ForwardToServer as CL_Cmd_ForwardToServer,
  createClientMainContext,
  type ClientMainContext
} from "../../../packages/client/src/cl_main.js";
import {
  CL_BuildActionEffects,
  CL_BuildEntityEventEffects,
  CL_AllocDlight,
  CL_ItemRespawnParticles,
  CL_LogoutEffect,
  CL_ParticleEffect,
  CL_TeleportParticles,
  CL_TeleporterParticles,
  type ClientActionEffect
} from "../../../packages/client/src/cl_fx.js";
import { CL_SmokeAndFlash } from "../../../packages/client/src/cl_tent.js";
import { createClientScreenContext } from "../../../packages/client/src/cl_scrn.js";
import {
  createClientSndDmaContext,
  S_BeginRegistration as S_DMA_BeginRegistration,
  S_EndRegistration as S_DMA_EndRegistration,
  S_Init as S_DMA_Init,
  S_IssueReadyPlaysounds as S_DMA_IssueReadyPlaysounds,
  S_IssuePlaysound as S_DMA_IssuePlaysound,
  S_RawSamples as S_DMA_RawSamples,
  S_RegisterSound as S_DMA_RegisterSound,
  S_Shutdown as S_DMA_Shutdown,
  S_StartLocalSound as S_DMA_StartLocalSound,
  S_StartSound as S_DMA_StartSound,
  S_StopAllSounds as S_DMA_StopAllSounds,
  S_Update as S_DMA_Update,
  type ClientSndDmaContext
} from "../../../packages/client/src/snd_dma.js";
import { createClientSoundLocalContext, type ClientSoundLocalContext, type playsound_t, type sfx_t } from "../../../packages/client/src/snd_loc.js";
import { CL_CalcViewValues, CL_UpdateLerpFraction, CL_PrepRefresh, createClientViewContext, V_Init } from "../../../packages/client/src/cl_view.js";
import { CL_PredictMovement, createClientPredictionCollisionSource } from "../../../packages/client/src/cl_pred.js";
import { createRefExport, type refexport_t, type refimport_t } from "../../../packages/client/src/ref.js";
import { createClientRuntime, connstate_t, type ClientRuntime } from "../../../packages/client/src/client.js";
import type { ClientRefreshFrame } from "../../../packages/client/src/index.js";
import { createClientVidMenuController, type ClientVidMenuController } from "../../../packages/client/src/vid-menu.js";
import {
  VID_CheckChanges,
  VID_Init,
  VID_Shutdown,
  createClientVidContext
} from "../../../packages/client/src/vid.js";
import {
  createWebAppCommandBridgeState,
  registerWebAppCommandBridge,
  syncWebAppLoadingState,
  type WebAppCommandBridgeState
} from "./command-bridge.js";
import {
  createWebConfigStorage,
  readWebConfigOrMountedText,
  type WebConfigStorage
} from "./web-config-storage.js";
import { createWebSaveStorage, type WebSaveStorage } from "./web-save-storage.js";
import { registerWebConfigCommands } from "./web-config-commands.js";
import { mapWebAppDomKey } from "./keymap.js";
import { createWebAppLocalTransport } from "./local-transport.js";
import { createWebRtcTransport, type WebRtcTransport } from "./webrtc-transport.js";
import { readSessionParams, startWebRtcSession } from "./webrtc-session.js";
import {
  createWebAppServerHost,
  type WebAppServerHost
} from "./server-host.js";
import {
  QGL_REQUIRED_PROCEDURES,
  createGlImageRuntime,
  createObjectQglProvider,
  createQuakeSkyResolver,
  createRefGlHost,
  createThreeBeamSync,
  createThreeDlightSync,
  createThreeGlDrawAdapter,
  createThreeGlWorldSceneAdapter,
  createThreeParticleSync,
  createThreePolyblendOverlay,
  createThreeRefreshEntitySync,
  createThreeSkySceneAdapter
} from "../../../packages/renderer-three/src/index.js";
import { createRefreshDebugLayer } from "./refresh-debug-layer.js";
import {
  createWebAppRenderLoop,
  type WebAppRenderLoop
} from "./render-loop.js";
import {
  attachMobileTouchControls,
  type MobileTouchControls
} from "../../../packages/Extended/src/index.js";
import {
  createWebAppServerRenderSource,
  getWebAppServerMapPath
} from "./render-source.js";
import {
  createCamera,
  createRenderer,
  type ActiveRenderer
} from "./web-render-bootstrap.js";

/**
 * Original name: N/A
 * Source: N/A (web adapter)
 * Category: New
 * Purpose: Configure browser asset lookup and the fixed Quake II canvas coordinate space.
 *
 * Porting notes:
 * - These constants are application bootstrap settings, not C/H-owned runtime symbols.
 */
const PUBLIC_BASE_URL = import.meta.env.BASE_URL;
const LOCAL_BASEQ2_URL = "/@fs/C:/a/Projets/Quake-2/Quake 2/baseq2";
const ROOT_BASEQ2_URL = "/baseq2";
const DEMO_BASEQ2_URL = `${PUBLIC_BASE_URL}baseq2`;

const STARTUP_CINEMATICS = [
  "idlog.cin",
  "ntro.cin"
];

const LOGICAL_WIDTH = 640;
const LOGICAL_HEIGHT = 480;
const FULL_GAME_SFF_HIDDEN = 0x02;
const FULL_GAME_SFF_SUBDIR = 0x08;
const FULL_GAME_SFF_SYSTEM = 0x10;

/**
 * Original name: N/A
 * Source: N/A (web adapter types)
 * Category: New
 * Purpose: Shape the browser page, canvas command queue, runtime aggregate, renderer state, audio debug state, and mouse state.
 *
 * Porting notes:
 * - These declarations describe apps/web integration state; they are not C/H-owned runtime entities.
 */
type DrawCommand =
  | { type: "pic"; x: number; y: number; name: string; width?: number; height?: number }
  | { type: "char"; x: number; y: number; code: number }
  | { type: "fill"; x: number; y: number; width: number; height: number; color: number }
  | { type: "raw"; x: number; y: number; width: number; height: number; cols: number; rows: number; data: Uint8Array }
  | { type: "fade" };

interface WebAppPage {
  root: HTMLElement;
  gameViewport: HTMLDivElement;
  frontendViewport: HTMLDivElement;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  status: HTMLElement;
  log: HTMLElement;
  perfHud: HTMLElement;
  perfHudEnabled: boolean;
}

type WebAppAssetMode = "auto" | "demo";

interface CanvasAssetCache {
  pictures: Map<string, HTMLCanvasElement | null>;
  glyphs: HTMLCanvasElement | null;
  paletteRgb: Uint8Array | null;
}

interface WebAppRuntime {
  client: ClientRuntime;
  menu: ClientMenuContext;
  console: ClientConsoleContext;
  mouse: WebAppMouseState;
  filesystem: VirtualFilesystem;
  configStorage: WebConfigStorage;
  saveStorage: WebSaveStorage;
  canvasRef: refexport_t;
  drawCommands: DrawCommand[];
  assets: CanvasAssetCache;
  audio: QuakeWebAudioAdapter;
  cdAudio: WebCDAudioAdapter;
  sndDma: ClientSndDmaContext;
  gameBridge: WebAppCommandBridgeState;
  qcommon: QcommonMiscRuntime;
  qcommonHost: QcommonHostRuntime;
  inputDevice: ClientInputDeviceContext;
  mobileControls: MobileTouchControls | null;
  serverHost: WebAppServerHost;
  frontendRenderer: WebAppFrontendRendererState | null;
  frontendRendererPromise: Promise<WebAppFrontendRendererState> | null;
  gameRenderer: WebAppRendererState | null;
  gameRendererPromise: Promise<WebAppRendererState> | null;
  gameRendererPromiseMapPath: string | null;
  currentCinematicIndex: number;
  mode: "cinematic" | "menu" | "loading" | "game";
  lastFrameTime: number;
  smoothedFps: number;
  cinematicStartedAt: number;
  flushClientOutput: () => void;
  updateClientAudio: () => void;
  writeConfiguration: () => boolean;
  shutdownClient: () => void;
  finishConfigBootstrap: () => void;
  captureClipboardText: (text: string) => void;
  attachMenuRendererRef: (ref: refexport_t | null) => void;
  syncVideoMenuOverlayOrigins: (viewportWidth: number, viewportHeight: number) => () => void;
  beginAuthoritativeConnection: (mapRequest: string) => void;
  isAuthoritativeLevelLoading: () => boolean;
  shouldPumpAuthoritativeFrame: () => boolean;
  pumpAuthoritativeFrame: (milliseconds: number) => void;
  authoritativeGameReady: () => boolean;
  markAuthoritativeGameActive: () => void;
  consoleRenderedInThree: boolean;
}

interface WebAppRendererState {
  mapPath: string;
  renderer: ActiveRenderer;
  rendererLabel: string;
  renderLoop: WebAppRenderLoop;
  camera: ReturnType<typeof createCamera>;
  ref: refexport_t;
  menuOverlayPicsWarmed: boolean;
  consoleCanvas: HTMLCanvasElement;
}

interface WebAppFrontendRendererState {
  renderer: ActiveRenderer;
  rendererLabel: string;
  glDrawAdapter: ReturnType<typeof createThreeGlDrawAdapter>;
  refGlHost: ReturnType<typeof createRefGlHost>;
  ref: refexport_t;
}

interface WebAppMenuRef extends refexport_t {
  setTarget: (target: refexport_t | null) => void;
}

interface WebAppMouseState {
  pointerLocked: boolean;
  pointerLockEscapeArmed: boolean;
  lookActive: boolean;
  dragging: boolean;
  suppressNextEscapeKeyUp: boolean;
}


void bootstrap();

/**
 * Original name: N/A
 * Source: N/A (web app bootstrap)
 * Category: New
 * Purpose: Mount assets, assemble the browser page, wire DOM events, and start the web-app frame loop.
 *
 * Porting notes:
 * - This is the web host entry point around the ported client/qcommon/menu subsystems.
 */
async function bootstrap(): Promise<void> {
  const app = requireApp();
  const page = createPage(app);

  try {
    page.status.textContent = "Chargement des assets Quake II...";
    const filesystem = await createMountedFilesystem();
    const runtime = createWebAppRuntime(filesystem, page);
    page.status.textContent = "Initialisation du renderer frontend...";
    await ensureWebAppFrontendRenderer(runtime, page);
    runtime.mobileControls = attachMobileTouchControls({
      root: page.root,
      isGameplayActive: () => runtime.mode === "game"
        && runtime.menu.keys.state.key_dest === keydest_t.key_game
        && runtime.client.cls.state === connstate_t.ca_active
        && !runtime.isAuthoritativeLevelLoading(),
      isMenuActive: () => runtime.menu.keys.state.key_dest === keydest_t.key_menu,
      getTime: () => runtime.client.cls.realtime,
      addCommandText: (text) => Cbuf_AddText(runtime.menu.cmd, text),
      applyLookDelta: (movementX, movementY) => {
        applyWebAppMouseLook(runtime, movementX, movementY);
      },
      pressMenuKey: (key) => {
        routeWebAppMenuKey(runtime, page, key);
      },
      menuKeys: {
        up: K_UPARROW,
        down: K_DOWNARROW,
        left: K_LEFTARROW,
        right: K_RIGHTARROW,
        enter: K_ENTER,
        escape: K_ESCAPE
      },
      onInteract: () => {
        void runtime.audio.unlock();
      }
    });
    void runtime.audio.unlock();

    resizeCanvas(page);
    window.addEventListener("resize", () => {
      resizeCanvas(page);
      if (runtime.frontendRenderer) {
        resizeWebAppFrontendRenderer(page, runtime.frontendRenderer);
      }
    });
    window.addEventListener("beforeunload", () => {
      runtime.finishConfigBootstrap();
      runtime.mobileControls?.dispose();
      runtime.shutdownClient();
      disposeWebAppFrontendRenderer(runtime);
      Qcommon_Shutdown(runtime.qcommon);
    });
    window.addEventListener("pointerdown", (event) => handlePointerDown(event, runtime, page), { capture: true });
    document.addEventListener("pointerlockchange", () => handlePointerLockChange(runtime, page));
    window.addEventListener("pointerlockerror", () => {
      runtime.mouse.pointerLocked = false;
      Con_Print(runtime.console.con, "pointer lock souris refuse par le navigateur\n", runtime.client.cls.realtime);
    });
    document.addEventListener("mousemove", (event) => handleMouseMove(event, runtime, page));
    document.addEventListener("keydown", (event) => handleKeyDown(event, runtime, page), { capture: true });
    document.addEventListener("keyup", (event) => handleKeyUp(event, runtime, page), { capture: true });
    document.addEventListener("paste", (event) => {
      runtime.captureClipboardText(event.clipboardData?.getData("text") ?? "");
    });
    window.addEventListener("mousedown", (event) => handleMouseButton(event, true, runtime, page));
    window.addEventListener("mouseup", (event) => handleMouseButton(event, false, runtime, page));
    window.addEventListener("wheel", (event) => handleMouseWheel(event, runtime, page), { passive: false });
    window.addEventListener("focus", () => {
      Sys_AppActivate(runtime.qcommonHost);
      IN_Activate(runtime.inputDevice, true);
      activateWebAppSound(runtime, true);
    });
    window.addEventListener("blur", () => {
      resetWebAppMouseLook(runtime);
      IN_Activate(runtime.inputDevice, false);
      if (document.visibilityState === "hidden") {
        activateWebAppSound(runtime, false);
      }
    });
    document.addEventListener("visibilitychange", () => {
      activateWebAppSound(runtime, document.visibilityState === "visible");
    });

    if (getWebAppAssetMode() === "demo") {
      page.status.textContent = "Pack demo charge.";
      enterMainMenu(runtime, page);
    } else {
      page.status.textContent = "Lancement de la boucle de demonstration...";
      startWebAppAttractLoop(runtime, page);
    }
    requestAnimationFrame((time) => frame(time, runtime, page));
  } catch (error) {
    const message = error instanceof Error ? error.message : `${error}`;
    page.status.textContent = "Echec du chargement.";
    page.log.style.display = "block";
    page.log.textContent = [
      "Impossible de lancer la page Quake II.",
      message,
      import.meta.env.DEV
        ? "En dev, Vite essaie l'installation locale puis apps/web/public/baseq2/."
        : `En production, pak0.pak doit etre publie sous ${PUBLIC_BASE_URL}baseq2/pak0.pak.`,
      "Les cinematics .cin sont optionnelles avec le pack demo shareware."
    ].join("\n");
  }
}

/**
 * Original name: N/A
 * Source: N/A (web page adapter)
 * Category: New
 * Purpose: Locate and construct the browser DOM/canvas shell used by the web-app host.
 *
 * Porting notes:
 * - These helpers own DOM setup only; they do not replace a C/H gameplay or renderer owner.
 */
function requireApp(): HTMLElement {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) {
    throw new Error("Element #app introuvable.");
  }
  return app;
}

function createPage(root: HTMLElement): WebAppPage {
  root.innerHTML = "";
  document.body.style.margin = "0";
  document.body.style.background = "#000";
  document.body.style.overflow = "hidden";
  const perfHudEnabled = isWebAppPerfHudEnabledFromUrl();

  const shell = document.createElement("main");
  shell.style.position = "fixed";
  shell.style.inset = "0";
  shell.style.background = "#000";
  shell.style.color = "#d8d2c7";
  shell.style.fontFamily = "Arial, Helvetica, sans-serif";

  const gameViewport = document.createElement("div");
  gameViewport.style.position = "absolute";
  gameViewport.style.inset = "0";
  gameViewport.style.background = "#000";
  gameViewport.style.overflow = "hidden";
  gameViewport.style.zIndex = "0";
  gameViewport.style.display = "none";

  const frontendViewport = document.createElement("div");
  frontendViewport.style.position = "absolute";
  frontendViewport.style.inset = "0";
  frontendViewport.style.background = "#000";
  frontendViewport.style.overflow = "hidden";
  frontendViewport.style.zIndex = "1";
  frontendViewport.style.display = "none";
  frontendViewport.style.pointerEvents = "none";

  const canvas = document.createElement("canvas");
  canvas.width = LOGICAL_WIDTH;
  canvas.height = LOGICAL_HEIGHT;
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.margin = "auto";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  canvas.style.objectFit = "contain";
  canvas.style.background = "#000";
  canvas.style.imageRendering = "pixelated";
  canvas.style.zIndex = "2";
  canvas.tabIndex = 0;

  const status = document.createElement("div");
  status.style.position = "absolute";
  status.style.left = "16px";
  status.style.top = "12px";
  status.style.padding = "6px 8px";
  status.style.background = "rgba(0, 0, 0, 0.55)";
  status.style.border = "1px solid rgba(216, 210, 199, 0.22)";
  status.style.fontSize = "12px";
  status.style.zIndex = "20";
  status.style.visibility = "hidden";
  status.style.pointerEvents = "none";

  const log = document.createElement("pre");
  log.style.position = "absolute";
  log.style.left = "16px";
  log.style.bottom = "12px";
  log.style.maxWidth = "min(720px, calc(100vw - 32px))";
  log.style.maxHeight = "35vh";
  log.style.overflow = "auto";
  log.style.margin = "0";
  log.style.whiteSpace = "pre-wrap";
  log.style.color = "#f0d060";
  log.style.background = "rgba(0, 0, 0, 0.62)";
  log.style.font = "12px Consolas, monospace";
  log.style.display = "none";
  log.style.zIndex = "25";

  const perfHud = document.createElement("div");
  perfHud.style.position = "absolute";
  perfHud.style.left = "8px";
  perfHud.style.bottom = "6px";
  perfHud.style.zIndex = "40";
  perfHud.style.padding = "2px 4px";
  perfHud.style.color = "rgba(230, 224, 210, 0.62)";
  perfHud.style.background = "rgba(0, 0, 0, 0.28)";
  perfHud.style.font = "10px Consolas, monospace";
  perfHud.style.lineHeight = "1.2";
  perfHud.style.letterSpacing = "0";
  perfHud.style.pointerEvents = "none";
  perfHud.style.display = perfHudEnabled ? "block" : "none";
  perfHud.textContent = "Renderer: ... | FPS: --";

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D indisponible.");
  }

  shell.append(gameViewport, frontendViewport, canvas, status, log, perfHud);
  root.append(shell);
  canvas.focus();

  return {
    root: shell,
    gameViewport,
    frontendViewport,
    canvas,
    context,
    status,
    log,
    perfHud,
    perfHudEnabled
  };
}

function isWebAppPerfHudEnabledFromUrl(): boolean {
  return new URLSearchParams(window.location.search).get("hud") === "1";
}

function getWebAppAssetMode(): WebAppAssetMode {
  return new URLSearchParams(window.location.search).get("assets") === "demo" ? "demo" : "auto";
}

function buildBaseq2PakCandidates(): string[] {
  if (getWebAppAssetMode() === "demo") {
    return [`${DEMO_BASEQ2_URL}/pak0.pak`];
  }

  return [
    ...(import.meta.env.DEV ? [`${LOCAL_BASEQ2_URL}/pak0.pak`] : []),
    `${DEMO_BASEQ2_URL}/pak0.pak`,
    ...(import.meta.env.DEV ? [`${ROOT_BASEQ2_URL}/pak0.pak`] : [])
  ];
}

function buildLooseVideoCandidates(): string[] {
  if (getWebAppAssetMode() === "demo") {
    return [DEMO_BASEQ2_URL];
  }

  return [
    ...(import.meta.env.DEV ? [LOCAL_BASEQ2_URL] : []),
    ...(import.meta.env.DEV ? [DEMO_BASEQ2_URL, ROOT_BASEQ2_URL] : [])
  ];
}

/**
 * Original name: N/A
 * Source: N/A (web filesystem bootstrap)
 * Category: New
 * Purpose: Load browser-accessible Quake II assets and mount them into the virtual filesystem.
 *
 * Porting notes:
 * - This is apps/web asset plumbing around the filesystem port.
 */
async function createMountedFilesystem(): Promise<VirtualFilesystem> {
  const pakBytes = await fetchFirstBytes(buildBaseq2PakCandidates());
  const looseVideos = new Map<string, Uint8Array>();

  for (const name of STARTUP_CINEMATICS) {
    const bytes = await fetchOptionalFirstBytes(buildLooseVideoCandidates().map((base) => `${base}/video/${name}`));
    if (bytes) {
      looseVideos.set(`video/${name}`, bytes);
    }
  }

  const filesystem = createVirtualFilesystem();
  looseVideos.set("pak0.pak", pakBytes);
  FS_AddGameDirectory(filesystem, "baseq2", looseVideos);
  return filesystem;
}

async function fetchFirstBytes(urls: string[]): Promise<Uint8Array> {
  const errors: string[] = [];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        errors.push(`${url}: ${response.status}`);
        continue;
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : `${error}`}`);
    }
  }

  throw new Error(`Aucun fichier accessible:\n${errors.join("\n")}`);
}

async function fetchOptionalFirstBytes(urls: string[]): Promise<Uint8Array | null> {
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return new Uint8Array(await response.arrayBuffer());
      }
    } catch {
      // Optional loose assets can still be loaded later from mounted PAK archives.
    }
  }

  return null;
}

function readWebAppMapList(filesystem: VirtualFilesystem): ClientMenuMapEntry[] | null {
  const bytes = FS_LoadFile(filesystem, "maps.lst");
  if (!bytes) {
    return null;
  }

  const text = new TextDecoder("latin1").decode(bytes);
  const entries: ClientMenuMapEntry[] = [];
  let index: number | null = 0;

  while (index !== null) {
    const shortName = COM_Parse(text, index);
    if (!shortName.token || shortName.nextIndex === null) {
      break;
    }

    const longName = COM_Parse(text, shortName.nextIndex);
    if (!longName.token) {
      break;
    }

    entries.push({
      shortName: shortName.token,
      longName: longName.token
    });
    index = longName.nextIndex;
  }

  return entries.length > 0 ? entries : null;
}

/**
 * Original name: IconOfSkinExists
 * Source: client/menu.c
 * Category: Adapter
 * Fidelity level: Close
 *
 * Porting notes:
 * - Operates on normalized browser filesystem paths while preserving the original
 *   "skin.pcx must have skin_i.pcx" rule.
 */
function fullGameIconOfSkinExists(skinPath: string, pcxfiles: string[]): boolean {
  const dotIndex = skinPath.lastIndexOf(".");
  const iconPath = `${dotIndex >= 0 ? skinPath.slice(0, dotIndex) : skinPath}_i.pcx`.toLowerCase();
  return pcxfiles.some((file) => file.toLowerCase() === iconPath);
}

function fullGamePathBasename(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function fullGameStripExtension(path: string): string {
  const basename = fullGamePathBasename(path);
  const dot = basename.lastIndexOf(".");
  return dot >= 0 ? basename.slice(0, dot) : basename;
}

function fullGameModelDirectoryName(directoryPath: string): string {
  return fullGamePathBasename(directoryPath).toLowerCase();
}

function addWebAppPlayerModel(models: Map<string, PlayerModelInfo>, directory: string, skins: string[]): void {
  if (skins.length === 0 || models.has(directory)) {
    return;
  }

  models.set(directory, {
    directory,
    displayname: directory.slice(0, 15),
    skins
  });
}

/**
 * Category: New
 * Purpose: Enumerate player model directories from mounted PAK archives for the browser menu adapter.
 *
 * Constraints:
 * - Mirrors the `PlayerConfig_ScanDirectories` ownership boundary without adding filesystem APIs to the menu port.
 */
function readWebAppPakPlayerModels(filesystem: VirtualFilesystem): PlayerModelInfo[] {
  const byDirectory = new Map<string, Set<string>>();
  const hasTris = new Set<string>();
  const hasIcon = new Set<string>();

  for (const search of filesystem.searchPaths) {
    if (!search.pack) {
      continue;
    }

    for (const entry of search.pack.archive.entries) {
      const name = entry.normalizedName;
      const match = /^players\/([^/]+)\/([^/]+)\.pcx$/.exec(name);
      if (name.match(/^players\/[^/]+\/tris\.md2$/)) {
        hasTris.add(name.split("/")[1]);
      } else if (match) {
        const [, directory, skinName] = match;
        if (skinName.endsWith("_i")) {
          hasIcon.add(`${directory}/${skinName.slice(0, -2)}`);
        } else {
          let skins = byDirectory.get(directory);
          if (!skins) {
            skins = new Set<string>();
            byDirectory.set(directory, skins);
          }
          skins.add(skinName);
        }
      }
    }
  }

  const models = new Map<string, PlayerModelInfo>();
  for (const [directory, skins] of byDirectory) {
    if (!hasTris.has(directory)) {
      continue;
    }

    addWebAppPlayerModel(
      models,
      directory,
      [...skins].filter((skin) => hasIcon.has(`${directory}/${skin}`)).sort()
    );
  }

  return [...models.values()];
}

/**
 * Original name: PlayerConfig_ScanDirectories
 * Source: client/menu.c
 * Category: Adapter
 * Fidelity level: Close
 *
 * Porting notes:
 * - Supplies the browser `getPlayerModels` hook used by the ported menu block.
 * - Checks loose mounted directories first, then PAK entries so the stock `pak0.pak`
 *   player models are available in `apps/web`.
 */
function readWebAppPlayerModels(filesystem: VirtualFilesystem): PlayerModelInfo[] | null {
  const models = new Map<string, PlayerModelInfo>();
  let path: string | null = null;

  while ((path = FS_NextPath(filesystem, path)) !== null) {
    const dirnames = FS_ListFiles(filesystem, `${path}/players/*.*`, FULL_GAME_SFF_SUBDIR, 0);

    for (const dirname of dirnames) {
      const directory = fullGameModelDirectoryName(dirname);
      if (FS_ListFiles(filesystem, `${dirname}/tris.md2`, 0, FULL_GAME_SFF_SUBDIR | FULL_GAME_SFF_HIDDEN | FULL_GAME_SFF_SYSTEM).length === 0) {
        continue;
      }

      const pcxfiles = FS_ListFiles(filesystem, `${dirname}/*.pcx`, 0, FULL_GAME_SFF_SUBDIR | FULL_GAME_SFF_HIDDEN | FULL_GAME_SFF_SYSTEM);
      const skins = pcxfiles
        .filter((file) => !file.toLowerCase().endsWith("_i.pcx"))
        .filter((file) => fullGameIconOfSkinExists(file, pcxfiles))
        .map(fullGameStripExtension)
        .sort();
      addWebAppPlayerModel(models, directory, skins);
    }
  }

  for (const model of readWebAppPakPlayerModels(filesystem)) {
    addWebAppPlayerModel(models, model.directory, model.skins);
  }

  const list = [...models.values()];
  return list.length > 0 ? list : null;
}

/**
 * Original name: N/A
 * Source: N/A (web runtime assembly)
 * Category: New
 * Purpose: Assemble ported client, qcommon, menu, sound, config, save, server, and renderer adapters for the browser host.
 *
 * Porting notes:
 * - The owned C/H behavior remains in packages/client, packages/qcommon, packages/server, and packages/renderer-three.
 */
function createWebAppRuntime(filesystem: VirtualFilesystem, page: WebAppPage): WebAppRuntime {
  const client = createClientRuntime();
  const mouse: WebAppMouseState = {
    pointerLocked: false,
    pointerLockEscapeArmed: false,
    lookActive: false,
    dragging: false,
    suppressNextEscapeKeyUp: false
  };
  const configStorage = createWebConfigStorage();
  const saveStorage = createWebSaveStorage();
  client.cls.state = connstate_t.ca_disconnected;
  let consoleContext: ClientConsoleContext | null = null;
  let mainContext: ClientMainContext | null = null;
  let configAutosaveEnabled = false;
  let configBootstrapPending = true;
  let configAutosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let writeConfigurationNow: () => boolean = () => false;
  // Connection-relevant engine output is always mirrored to devtools: the
  // engine reports progress and failures only to its own console, which cannot
  // be read while the menu is up. ?debug=1 mirrors everything, including the
  // precache list, which is far too noisy by default.
  const engineConsoleVerbose =
    new URLSearchParams(window.location.search).get("debug") === "1";
  const engineConsoleInteresting =
    /connect|challenge|entered the game|Bad server|SpawnServer|SV_GameMap|InitGame|dropped|error|denied|full|password|version/i;

  const printToConsole = (line: string): void => {
    const trimmed = line.trimEnd();
    if (engineConsoleVerbose || engineConsoleInteresting.test(trimmed)) {
      console.log("[q2-engine]", trimmed);
    }


    if (shouldSuppressWebAppConsoleLine(line)) {
      return;
    }

    if (!consoleContext) {
      appendLog(page, line);
      return;
    }

    const text = line.endsWith("\n") ? line : `${line}\n`;
    Con_Print(consoleContext.con, text, client.cls.realtime);
    Con_SyncConsoleToKeys(consoleContext);
  };

  const cvar = createCvarRuntime({
    onPrint: printToConsole,
    onGameDirChange: (value) => {
      const applied = FS_SetGamedir(filesystem, value);
      if (!applied) {
        printToConsole(`gamedir invalide: ${value}`);
        return;
      }

      Cbuf_AddText(cmd, "exec config.cfg\n");
    },
    onExecAutoexec: () => {
      Cbuf_AddText(cmd, "exec autoexec.cfg\n");
    }
  });
  const qcommonHooks: QcommonMiscRuntime["hooks"] = {};
  const qcommon = createQcommonMiscRuntime(qcommonHooks);
  const qcommonGlobals = createQcommonGlobals();
  const inputDevice = createClientInputDeviceContext();
  const inputDeviceMainHooks = createClientInputDeviceMainHooks(inputDevice);
  let clipboardText = "";
  const qcommonHost = createQcommonHostRuntime({
    sysConsoleOutput: printToConsole,
    sysSendKeyEvents: () => undefined,
    sysGetClipboardData: () => clipboardText || null,
    sysQuit: () => {
      throw new Error("Sys_Quit");
    },
    sysCopyProtect: () => undefined
  });
  const captureClipboardText = (text: string): void => {
    clipboardText = text;
  };
  const scheduleConfigAutosave = (): void => {
    if (!configAutosaveEnabled) {
      return;
    }

    if (configAutosaveTimer !== null) {
      clearTimeout(configAutosaveTimer);
    }

    configAutosaveTimer = setTimeout(() => {
      configAutosaveTimer = null;
      writeConfigurationNow();
    }, 400);
  };
  cvar.hooks.onVariableSet = (variable) => {
    if ((variable.flags & CVAR_ARCHIVE) !== 0) {
      scheduleConfigAutosave();
    }
  };
  const cmd = createCommandRuntime({
    onPrint: printToConsole,
    loadTextFile: (path) => readWebConfigOrMountedText(configStorage, filesystem, path),
    executeUnknownCommand: (_name, text) => {
      const result = Cvar_Command(cvar, cmd);
      if (result.output) {
        printToConsole(result.output);
      }
      if (result.handled) {
        return true;
      }

      if (mainContext) {
        CL_Cmd_ForwardToServer(mainContext, {
          onPrint: printToConsole
        });
        return true;
      }

      printToConsole(`Unknown command "${text}"`);
      return true;
    }
  });

  Cmd_Init(cmd);
  Cvar_Init(cvar, cmd);
  seedMenuCvars(cvar);

  const drawCommands: DrawCommand[] = [];
  const assets: CanvasAssetCache = {
    pictures: new Map(),
    glyphs: null,
    paletteRgb: null
  };
  const audio = createQuakeWebAudioAdapter({
    logs: {
      onInfo: () => undefined,
      onWarning: printToConsole
    }
  });
  const cdAudio = createWebCDAudioAdapter({
    context: audio.context,
    filesystem,
    logs: {
      onInfo: () => undefined,
      onWarning: printToConsole
    }
  });
  let sndDmaContext: ClientSndDmaContext | null = null;
  let frontendRenderer: WebAppFrontendRendererState | null = null;
  let frontendRendererPromise: Promise<WebAppFrontendRendererState> | null = null;
  let gameRenderer: WebAppRendererState | null = null;
  let gameRendererPromise: Promise<WebAppRendererState> | null = null;
  let gameRendererPromiseMapPath: string | null = null;
  let consoleRenderedInThree = false;
  let webSoundDmaFrameBase = 0;
  let lastAudioResumeTime = 0;
  /**
   * Original name: N/A
   * Source declaree: N/A (web audio recovery helper)
   * Category: New
   * Purpose: Resume a browser-suspended AudioContext during active gameplay without changing Quake sound ownership.
   */
  const resumeWebAppAudioIfNeeded = (): void => {
    const contextState = audio.context?.state ?? "unavailable";
    if (contextState === "running" || contextState === "unavailable" || contextState === "closed") {
      return;
    }

    if (client.cls.realtime - lastAudioResumeTime < 500) {
      return;
    }

    lastAudioResumeTime = client.cls.realtime;
    void audio.resume().catch(() => undefined);
  };
  const soundLocal = createClientSoundLocalContext({
    onSNDDMA_Init: () => {
      const initialized = initializeWebSoundDma(soundLocal, audio);
      webSoundDmaFrameBase = initialized ? getWebSoundDmaAbsoluteFrame(soundLocal, audio) : 0;
      return initialized;
    },
    onSNDDMA_GetDMAPos: () => getWebSoundDmaPosition(soundLocal, audio),
    onSNDDMA_GetDMAFrame: () => getRelativeWebSoundDmaFrame(),
    onSNDDMA_Shutdown: () => {
      audio.stopAll();
      webSoundDmaFrameBase = 0;
      soundLocal.state.dma.buffer = null;
      soundLocal.state.dma.samplepos = 0;
    },
    onFS_LoadFile: (path) => readMountedFile(filesystem, path)?.bytes ?? null,
    onFS_FreeFile: () => undefined,
    onComPrintf: printToConsole,
    onComDPrintf: printToConsole,
    onS_IssuePlaysound: (ps) => {
      if (!sndDmaContext) {
        return;
      }
      playIssuedWebSound(sndDmaContext, audio, ps);
    }
  });
  /**
   * Original name: N/A
   * Source declaree: N/A (web DMA timing adapter)
   * Category: New
   * Purpose: Read WebAudio DMA time relative to the latest point where the ported mixer could actually paint.
   */
  const getRelativeWebSoundDmaFrame = (): number => {
    const absoluteFrame = getWebSoundDmaAbsoluteFrame(soundLocal, audio);
    if (sndDmaContext?.state.soundtime === 0 && soundLocal.state.paintedtime === 0) {
      webSoundDmaFrameBase = absoluteFrame;
      return 0;
    }

    return Math.max(0, absoluteFrame - webSoundDmaFrameBase);
  };
  /**
   * Original name: N/A
   * Source declaree: N/A (web DMA timing adapter)
   * Category: New
   * Purpose: Keep WebAudio DMA time paused while Quake has disabled screen/audio painting for loading.
   */
  const pauseWebSoundDmaClockAtSoundtime = (): void => {
    if (!sndDmaContext) {
      return;
    }

    webSoundDmaFrameBase = Math.max(
      0,
      getWebSoundDmaAbsoluteFrame(soundLocal, audio) - sndDmaContext.state.soundtime
    );
  };

  const canvasRef = createCanvasRef(filesystem, assets, drawCommands);
  const menuRef = createMirroredMenuRef(canvasRef);
  const keys = createClientKeyContext({
    cmd,
    cvar,
    client,
    host: qcommonHost,
    hooks: {
      onSetBinding: () => scheduleConfigAutosave()
    }
  });
  // Multiplayer arrives as ?room=&player=&host= from the lobby. Without those
  // this is unchanged: a single-player loopback that never touches the network.
  const rtcSession = readSessionParams();
  const transportOptions = {
    now: () => client.cls.realtime,
    onPrint: printToConsole
  };
  const localTransport = rtcSession
    ? createWebRtcTransport({
        role: rtcSession.isHost ? "host" : "client",
        ...transportOptions
      })
    : createWebAppLocalTransport(transportOptions);
  if (rtcSession) {
    void startWebRtcSession(rtcSession, localTransport as WebRtcTransport, (text) =>
      Cbuf_AddText(cmd, text)
    ).catch(
      (error: unknown) => {
        printToConsole(
          `multiplayer: ${error instanceof Error ? error.message : String(error)}\n`
        );
      }
    );
  }
  const fileExists = (path: string): boolean => readMountedFile(filesystem, path) !== undefined || saveStorage.exists(path);
  const loadBinaryFile = (path: string): Uint8Array | null => readMountedFile(filesystem, path)?.bytes ?? saveStorage.readBinary(path);
  const downloadFileHooks = createWebDownloadFileHooks(saveStorage);
  const getMapInfo = (path: string): { checksum: number | null; textureNames: string[] } | null => {
    const file = readMountedFile(filesystem, path);
    const bytes = file?.bytes ?? saveStorage.readBinary(path);
    if (!bytes) {
      return null;
    }

    const map = parseBsp(bytes, file?.path ?? path);
    return {
      checksum: Com_BlockChecksum(bytes, bytes.length),
      textureNames: map.texinfo.map((texinfo) => texinfo.texture)
    };
  };
  const prepClientRefresh = (): void => {
    const options = {
      ref: canvasRef,
      viewportWidth: LOGICAL_WIDTH,
      viewportHeight: LOGICAL_HEIGHT,
      crosshairValue: Cvar_VariableValue(cvar, "crosshair"),
      ...(consoleContext ? { console: consoleContext.con } : {}),
      onPrint: printToConsole,
      onUpdateScreen: () => undefined,
      onPumpEvents: () => undefined,
      onPlayCdTrack: (track: number, looping: boolean) => {
        cdAudio.play(track, looping);
      },
      inlineModel: (name: string) => activeServerHost?.hasActiveGameMap()
        ? CM_InlineModel(activeServerHost.collisionWorld, name)
        : null
    };
    if (CL_PrepRefresh(client, options)) {
      clearWebAppLoadingPlaque(client);
    }
  };
  const registerAuthoritativeSound = (path: string): sfx_t | string => {
    const context = sndDmaContext;
    if (!context) {
      return path;
    }

    return S_DMA_RegisterSound(context, path) ?? path;
  };
  const registerAuthoritativeSounds = (): void => {
    const context = sndDmaContext;
    if (!context) {
      CL_RegisterSounds(client);
      return;
    }

    CL_RegisterSounds(client, {
      onBeginRegistration: () => {
        S_DMA_BeginRegistration(context);
      },
      onRegisterSound: (path) => registerAuthoritativeSound(path),
      onEndRegistration: () => {
        S_DMA_EndRegistration(context);
      }
    });
  };
  const initAuthoritativeSound = (): void => {
    if (!sndDmaContext) {
      return;
    }

    S_DMA_Init(sndDmaContext);
  };
  const shutdownAuthoritativeSound = (): void => {
    if (!sndDmaContext) {
      return;
    }

    S_DMA_Shutdown(sndDmaContext);
  };
  const stopAllAuthoritativeSounds = (): void => {
    if (!sndDmaContext) {
      return;
    }

    S_DMA_StopAllSounds(sndDmaContext);
    audio.stopAll();
  };
  const syncAuthoritativeSoundListener = (): void => {
    if (!sndDmaContext) {
      return;
    }

    const listener = buildWebAppAudioListener(client);
    sndDmaContext.sound.state.listener_origin = [...listener.origin];
    sndDmaContext.sound.state.listener_forward = [...listener.forward];
    sndDmaContext.sound.state.listener_right = [...listener.right];
    sndDmaContext.sound.state.listener_up = [...listener.up];
  };
  const startAuthoritativeLocalSound = (name: string): void => {
    if (!sndDmaContext) {
      return;
    }

    S_DMA_StartLocalSound(sndDmaContext, name);
  };
  const resolveAuthoritativeSfx = (sound: unknown): sfx_t | null => {
    if (isSfx(sound)) {
      return sound;
    }

    if (typeof sound !== "string" || sound.length === 0 || !sndDmaContext) {
      return null;
    }

    return S_DMA_RegisterSound(sndDmaContext, sound);
  };
  const startAuthoritativeSound = (
    origin: [number, number, number] | null,
    ent: number,
    channel: number,
    sound: unknown,
    volume: number,
    attenuation: number,
    timeofs: number
  ): void => {
    if (!sndDmaContext) {
      return;
    }

    const sfx = resolveAuthoritativeSfx(sound);
    syncAuthoritativeSoundListener();
    S_DMA_StartSound(
      sndDmaContext,
      origin,
      ent,
      channel,
      sfx,
      volume,
      attenuation,
      timeofs
    );
    if (timeofs <= 0) {
      for (const issued of S_DMA_IssueReadyPlaysounds(sndDmaContext)) {
        audio.playChannel(issued);
      }
    }
  };
  const startAuthoritativeEffectSounds = (effects: ClientActionEffect[]): void => {
    for (const effect of effects) {
      if (!effect.sound) {
        continue;
      }

      const volume = effect.sound.volume ?? 1;
      const timeofs = effect.sound.delayMs !== undefined ? effect.sound.delayMs / 1000 : 0;
      startAuthoritativeSound(
        effect.position ?? null,
        effect.entity ?? 0,
        effect.sound.channel,
        effect.sound.name,
        volume,
        effect.sound.attenuation,
        timeofs
      );
    }
  };
  const applyAuthoritativeVisualEffects = (effects: ClientActionEffect[]): void => {
    for (const effect of effects) {
      if (effect.light && effect.position && effect.entity !== undefined) {
        const dlight = CL_AllocDlight(client, effect.entity);
        dlight.origin = [...effect.position];
        dlight.radius = effect.light.radius;
        dlight.minlight = effect.light.minlight ?? 0;
        dlight.die = client.cl.time + effect.light.durationMs;
        dlight.decay = 0;
        dlight.color = [...effect.light.color];
      }

      if (effect.kind === "particle-effect" && effect.position) {
        CL_ParticleEffect(client, effect.position, [0, 0, 0], effect.color ?? 0, effect.count ?? 0);
      } else if (effect.kind === "item-respawn-particles" && effect.position) {
        CL_ItemRespawnParticles(client, effect.position);
      } else if (effect.kind === "teleport-particles" && effect.position) {
        CL_TeleportParticles(client, effect.position);
      } else if (effect.kind === "teleporter-particles" && effect.position) {
        CL_TeleporterParticles(client, effect.position);
      } else if (effect.kind === "smoke-and-flash" && effect.position) {
        CL_SmokeAndFlash(client, effect.position);
      } else if (
        effect.position
        && effect.packet
        && "weapon" in effect.packet
        && (effect.kind === "login" || effect.kind === "logout" || effect.kind === "respawn")
      ) {
        CL_LogoutEffect(client, effect.position, effect.packet.weapon);
      }
    }
  };
  const applyAuthoritativeActionEffects = (effects: ClientActionEffect[]): void => {
    applyAuthoritativeVisualEffects(effects);
    startAuthoritativeEffectSounds(effects);
  };
  let activeServerHost: WebAppServerHost | null = null;
  let menuContext: ClientMenuContext | null = null;
  const forceGameInputForLevelLoad = (): void => {
    if (keys.state.key_dest === keydest_t.key_console || keys.state.key_dest === keydest_t.key_message) {
      return;
    }

    if (menuContext) {
      M_ForceMenuOff(menuContext);
    } else {
      keys.state.key_dest = keydest_t.key_game;
      keys.state.console_open = false;
    }
  };
  mainContext = createClientMainContext(client, cmd, cvar);
  CL_InitLocal(mainContext, {
    getMilliseconds: () => client.cls.realtime,
    qnet: localTransport.clientQnet,
    serverRunning: () => activeServerHost?.hasActiveServer() ?? false,
    allowDownload: false,
    fileExists,
    loadBinaryFile,
    getPartialDownloadSize: (path: string) => saveStorage.readBinary(path)?.byteLength ?? null,
    getMapInfo,
    onPrepRefresh: prepClientRefresh,
    onRegisterSounds: registerAuthoritativeSounds,
    onBegin: () => {
      clearWebAppLoadingPlaque(client);
    },
    onPrint: printToConsole,
    onDisconnect: () => {
      stopAllAuthoritativeSounds();
      printToConsole("Disconnected.");
    },
    onSoundShutdown: shutdownAuthoritativeSound,
    onSoundInit: initAuthoritativeSound,
    onStopAllSounds: stopAllAuthoritativeSounds,
    onStartLocalSound: startAuthoritativeLocalSound,
    onQuit: () => printToConsole("Quit demande."),
    onBeginLoadingPlaque: () => {
      authoritativeLevelLoading = true;
      client.cl.screen.scr_draw_loading = 1;
      forceGameInputForLevelLoad();
    },
    onEndLoadingPlaque: () => {
      clearWebAppLoadingPlaque(client);
    },
    onServerConnectRequest: (servername) => {
      printToConsole(`Connecting to ${servername}...`);
    },
    onEnableRemoteNetworking: () => undefined,
    onPingServer: (message, destination) => {
      printToConsole(`ping ${destination}: ${message.trimEnd()}`);
    },
    onAddToServerList: (address: netadr_t, info: string) => {
      if (menuContext) {
        M_AddToServerList(menuContext, address, info);
      }
    },
    onSendRcon: (_message, destination) => {
      printToConsole(`rcon vers ${destination} non branche.`);
    },
    getGameDir: () => FS_Gamedir(filesystem),
    onWriteConfigFile: (path, contents) => configStorage.writeText(path, contents)
  });
  const inputContext = createClientInputContext(client, cmd, cvar, {
    qnet: localTransport.clientQnet,
    inputDevice
  });
  CL_InitInput(inputContext);
  inputDeviceMainHooks.onInputInit();
  const sendClientCommand = createClientSendCmdBridge(inputContext, {
    getFrameOptions: () => ({
      anykeydown: keys.state.anykeydown > 0,
      key_game_active: keys.state.key_dest === keydest_t.key_game
    })
  });
  const viewContext = createClientViewContext(client, cmd, cvar);
  V_Init(viewContext);
  const screenContext = createClientScreenContext(client, cmd, cvar);
  SCR_Init(screenContext);
  const gameBridge = createWebAppCommandBridgeState();
  let pendingAuthoritativeMapRequest: string | null = null;
  let authoritativeLevelLoading = false;
  const beginAuthoritativeConnection = (mapRequest: string): void => {
    if (pendingAuthoritativeMapRequest === mapRequest) {
      return;
    }

    authoritativeLevelLoading = true;
    pendingAuthoritativeMapRequest = mapRequest;
    forceGameInputForLevelLoad();
    localTransport.clear();
    client.cls.state = connstate_t.ca_disconnected;
    client.cl.refresh_prepped = false;
    client.cl.screen.scr_draw_loading = 1;
  };
  const serverHost = createWebAppServerHost({
    cmd,
    cvar,
    filesystem,
    getGameDir: () => FS_Gamedir(filesystem),
    saveStorage,
    qnet: localTransport.serverQnet,
    host_speeds: Cvar_Get(cvar, "host_speeds", "0", 0),
    setTimeBeforeGame: (milliseconds) => {
      qcommonGlobals.time_before_game = milliseconds;
    },
    setTimeAfterGame: (milliseconds) => {
      qcommonGlobals.time_after_game = milliseconds;
    },
    onPrint: printToConsole,
    onBeginLoading: () => {
      authoritativeLevelLoading = true;
      client.cl.screen.scr_draw_loading = 1;
      forceGameInputForLevelLoad();
    }
  });
  activeServerHost = serverHost;
  const predictAuthoritativeClientMovement = (): void => {
    if (serverHost.hasActiveAttractLoop()) {
      return;
    }

    const incomingAcknowledged = client.cls.netchan.incoming_acknowledged;
    const outgoingSequence = client.cls.netchan.outgoing_sequence;
    const predictionCollision = serverHost.hasActiveGameMap()
      ? createClientPredictionCollisionSource(client, serverHost.collisionWorld)
      : undefined;
    CL_PredictMovement(client, {
      incomingAcknowledged,
      outgoingSequence,
      predictMovement: true,
      ...(predictionCollision ? { predictionCollision } : {})
    });
  };
  const createAuthoritativeClientHooks = (withReadPackets: boolean) => ({
    ...inputDeviceMainHooks,
    getMilliseconds: () => client.cls.realtime,
    qnet: localTransport.clientQnet,
    serverRunning: () => serverHost.hasActiveServer(),
    onPrint: printToConsole,
    onStufftext: (text: string) => {
      Cbuf_AddText(cmd, text);
    },
    onPlayCinematic: (name: string) => {
      const started = tryPlayWebAppCinematic(client, name, {
        loadBinaryFile: (path) => readMountedFile(filesystem, path)?.bytes ?? null,
        onCinematicRawSamples: (count, sampleRate, sampleWidth, channels, samples) => {
          S_DMA_RawSamples(sndDma, count, sampleRate, sampleWidth, channels, samples);
          audio.queueRawSamples(count, sampleRate, sampleWidth, channels, samples);
        },
        onCinematicSoundRestart: () => {
          audio.stopRaw();
        },
        onCDAudioStop: () => {
          cdAudio.stop();
        },
        onError: (message) => printToConsole(`cinematique ignoree ${name}: ${message}`)
      });
      if (!started) {
        printToConsole(`cinematique introuvable: ${name}`);
      }
    },
    onSoundShutdown: shutdownAuthoritativeSound,
    onSoundInit: initAuthoritativeSound,
    onStopAllSounds: stopAllAuthoritativeSounds,
    onStartLocalSound: startAuthoritativeLocalSound,
    onDisconnect: stopAllAuthoritativeSounds,
    onExecuteCommandBuffer: () => {
      Cbuf_Execute(cmd);
    },
    ...(withReadPackets ? {
      onReadPackets: () => {
        CL_ReadPackets(mainContext!, createAuthoritativeClientHooks(false));
      }
    } : {}),
    onSendCmd: sendClientCommand,
    onPredictMovement: predictAuthoritativeClientMovement,
    onPrepRefresh: prepClientRefresh,
    onRegisterSounds: registerAuthoritativeSounds,
    onVideoCheckChanges: () => {
      VID_CheckChanges(vid);
    },
    hostSpeedsEnabled: () => (qcommonGlobals.host_speeds?.value ?? 0) !== 0,
    onHostSpeedTimeBeforeRef: (milliseconds: number) => {
      qcommonGlobals.time_before_ref = milliseconds;
    },
    onHostSpeedTimeAfterRef: (milliseconds: number) => {
      qcommonGlobals.time_after_ref = milliseconds;
    },
    logStatsEnabled: () => (qcommonGlobals.log_stats?.value ?? 0) !== 0,
    onLogStatSample: () => undefined,
    onAddToServerList: (address: netadr_t, info: string) => {
      if (menuContext) {
        M_AddToServerList(menuContext, address, info);
      }
    },
    onStartSound: startAuthoritativeSound,
    getPartialDownloadSize: (path: string) => saveStorage.readBinary(path)?.byteLength ?? null,
    ...downloadFileHooks,
    onMuzzleFlash: (packet: ClientMuzzleFlashPacket) => {
      applyAuthoritativeActionEffects(CL_BuildActionEffects(packet, client));
    },
    onMuzzleFlash2: (packet: ClientMuzzleFlash2Packet) => {
      applyAuthoritativeActionEffects(CL_BuildActionEffects(packet, client));
    },
    onTempEntity: (packet: ClientTempEntityPacket) => {
      startAuthoritativeEffectSounds(CL_BuildActionEffects(packet, client));
    },
    onEntityEvent: (event: ClientEntityEvent) => {
      applyAuthoritativeActionEffects(CL_BuildEntityEventEffects(event, {
        clFootsteps: client.cl.cl_footsteps
      }));
    },
    onEndLoadingPlaque: () => {
      clearWebAppLoadingPlaque(client);
    },
    onBegin: () => {
      clearWebAppLoadingPlaque(client);
    },
    onPlayCdTrack: (track: number, looping: boolean) => {
      cdAudio.play(track, looping);
    },
    onSetGameDir: (gamedir: string) => {
      QcommonCvar_Set(cvar, "game", gamedir);
    },
    registerModel: (path: string) => canvasRef.RegisterModel(path),
    registerSkin: (path: string) => canvasRef.RegisterSkin(path),
    registerPic: (path: string) => canvasRef.RegisterPic(path),
    registerSound: registerAuthoritativeSound
  });
  const shouldPumpAuthoritativeFrame = (): boolean => (
    serverHost.hasActiveServer()
    || client.cls.state === connstate_t.ca_connecting
    || client.cls.state === connstate_t.ca_connected
    || client.cls.state === connstate_t.ca_active
  );
  qcommonHooks.onFrame = (milliseconds: number): void => {
    const msec = Math.max(0, Math.trunc(milliseconds));
    CL_Frame(mainContext!, msec, createAuthoritativeClientHooks(true));
    serverHost.frame(msec);
    CL_ReadPackets(mainContext!, createAuthoritativeClientHooks(false));
  };
  const pumpAuthoritativeFrame = (milliseconds: number): void => {
    Qcommon_Frame(qcommon, milliseconds, {
      cmd,
      cvar,
      globals: qcommonGlobals
    });
  };
  const authoritativeGameReady = (): boolean => (
    (serverHost.hasActiveGameMap() || serverHost.hasActiveAttractLoop())
    && client.cls.state === connstate_t.ca_active
    && client.cl.refresh_prepped
  );
  const markAuthoritativeGameActive = (): void => {
    const wasLevelLoading = authoritativeLevelLoading;
    authoritativeLevelLoading = false;
    clearWebAppLoadingPlaque(client);
    if (wasLevelLoading
      && keys.state.key_dest !== keydest_t.key_console
      && keys.state.key_dest !== keydest_t.key_message) {
      forceGameInputForLevelLoad();
    } else if (keys.state.key_dest !== keydest_t.key_console
      && keys.state.key_dest !== keydest_t.key_message
      && keys.state.key_dest !== keydest_t.key_menu) {
      keys.state.key_dest = keydest_t.key_game;
    }
    pendingAuthoritativeMapRequest = null;
    gameBridge.requestedMap = null;
    gameBridge.serverRunning = true;
    gameBridge.phase = "idle";
  };
  registerWebAppCommandBridge(cmd, cvar, client, gameBridge, {
    onPrint: printToConsole,
    onBeginLoading: () => {
      client.cl.screen.scr_draw_loading = 1;
    },
    onKillServer: () => {
      authoritativeLevelLoading = false;
      pendingAuthoritativeMapRequest = null;
      localTransport.clear();
      client.cls.state = connstate_t.ca_disconnected;
    },
    getNewGameMap: () => selectWebAppNewGameMap(filesystem),
    onMapRequested: (map, source) => {
      printToConsole(`${source} ${map}: preparation du host jeu final.`);
      beginAuthoritativeConnection(map);
    }
  });
  Qcommon_Init(qcommon, {
    cmd,
    cvar,
    globals: qcommonGlobals
  });

  consoleContext = createClientConsoleContext({
    client,
    keys,
    cmd,
    cvar,
    filesystem,
    hooks: {
      onPrint: printToConsole,
      onWriteTextFile: (path) => printToConsole(`console dump: ${path}`),
      onCreatePath: () => undefined
    }
  });
  Con_Init(consoleContext, LOGICAL_WIDTH);
  const sndDma = createClientSndDmaContext(client, cmd, cvar, soundLocal);
  sndDmaContext = sndDma;
  S_DMA_Init(sndDma);

  const qmenu = createClientQMenuContext({
    getMilliseconds: () => client.cls.realtime,
    getClipboardData: () => qcommonHost.hooks.sysGetClipboardData?.() ?? null,
    onDrawChar: (command) => {
      menuRef.DrawChar(command.x, command.y, command.c);
    },
    onDrawFill: (command) => {
      menuRef.DrawFill(command.x, command.y, command.w, command.h, command.c);
    }
  });
  let videoMenu: ClientVidMenuController | null = null;
  const syncWebVideoState = (): void => {
    vid.viddef.width = LOGICAL_WIDTH;
    vid.viddef.height = LOGICAL_HEIGHT;

    for (const name of ["vid_ref", "vid_fullscreen", "vid_gamma", "vid_xpos", "vid_ypos", "win_noalttab"]) {
      const variable = Cvar_Get(cvar, name, name === "vid_ref" ? "gl" : "0", CVAR_ARCHIVE);
      if (variable !== null) {
        variable.modified = false;
      }
    }
  };
  const vid = createClientVidContext({
    onInit: () => {
      Cvar_Get(cvar, "vid_ref", "gl", CVAR_ARCHIVE);
      Cvar_Get(cvar, "vid_xpos", "3", CVAR_ARCHIVE);
      Cvar_Get(cvar, "vid_ypos", "22", CVAR_ARCHIVE);
      Cvar_Get(cvar, "vid_fullscreen", "0", CVAR_ARCHIVE);
      Cvar_Get(cvar, "vid_gamma", "1", CVAR_ARCHIVE);
      Cvar_Get(cvar, "win_noalttab", "0", CVAR_ARCHIVE);
      if (!Cmd_Exists(cmd, "vid_restart")) {
        Cmd_AddCommand(cmd, "vid_restart", () => {
          VID_CheckChanges(vid);
        });
      }
      if (!Cmd_Exists(cmd, "vid_front")) {
        Cmd_AddCommand(cmd, "vid_front", () => undefined);
      }
      VID_CheckChanges(vid);
    },
    onShutdown: () => {
      videoMenu = null;
    },
    onCheckChanges: syncWebVideoState,
    onMenuInit: () => {
      if (!menuContext) {
        return;
      }
      const controller = createClientVidMenuController(menuContext, {
        onApplyChanges: () => {
          printToConsole("changements video appliques aux cvars web.");
        }
      });
      videoMenu = controller;
      controller.VID_MenuInit();
    },
    onMenuDraw: () => {
      videoMenu?.VID_MenuDraw();
    },
    onMenuKey: (key) => videoMenu?.VID_MenuKey(key) ?? null
  });
  VID_Init(vid);
  keys.hooks.onPrint = printToConsole;
  Key_Init(keys);

  const menu = createClientMenuContext({
    client,
    keys,
    qmenu,
    cmd,
    cvar,
    vid,
    ref: menuRef,
    hooks: {
      startLocalSound: (name) => {
        startAuthoritativeLocalSound(name);
      },
      getSaveSlots: () => saveStorage.getSaveSlots(FS_Gamedir(filesystem)),
      getMapList: () => readWebAppMapList(filesystem),
      getPlayerModels: () => readWebAppPlayerModels(filesystem),
      getServerState: () => serverHost.hasActiveServer() ? 1 : 0,
      onClearNotify: () => Con_ClearNotify(consoleContext.con),
      onQuit: () => printToConsole("Quit demande.")
    }
  });
  menuContext = menu;
  consoleContext.hooks.M_ForceMenuOff = () => {
    M_ForceMenuOff(menu);
  };
  keys.hooks.onMenuKeydown = (key) => M_Keydown(menu, key);
  keys.hooks.onMenuMain = () => M_Menu_Main_f(menu);
  keys.hooks.onToggleConsole = () => {
    toggleWebAppConsoleContext(menu, consoleContext, page, client);
  };
  M_Init(menu);
  registerWebAppToggleConsoleCommand(cmd, () => {
    toggleWebAppConsoleContext(menu, consoleContext, page, client);
  });
  queueWebAppConfigBootstrap(cmd);
  // Multiplayer: the engine otherwise boots to its main menu and waits. The
  // host starts a listen server; the joining side connects instead, but only
  // once its data channel is open (see webrtc-session).
  // Carry the lobby identity into Quake 2, which keeps its own name cvar and
  // would otherwise show everyone as the default player.
  if (rtcSession) {
    Cbuf_AddText(cmd, `set name "${rtcSession.name}"\n`);
  }
  if (rtcSession?.isHost) {
    Cbuf_AddText(cmd, "set deathmatch 1\n");
    Cbuf_AddText(cmd, `set maxclients ${rtcSession.maxClients}\n`);
    Cbuf_AddText(cmd, `map ${rtcSession.map}\n`);
  }
  const flushClientOutput = (): void => {
    while (client.output.length > 0) {
      const line = client.output.shift();
      if (line) {
        printToConsole(line);
      }
    }
  };
  const updateClientAudio = (): void => {
    if (client.cls.state === connstate_t.ca_active
      && keys.state.key_dest === keydest_t.key_game
      && document.visibilityState === "visible") {
      resumeWebAppAudioIfNeeded();
    }

    const listener = buildWebAppAudioListener(client);
    if (client.cls.disable_screen !== 0) {
      pauseWebSoundDmaClockAtSoundtime();
    }
    S_DMA_Update(sndDma, listener.origin, listener.forward, listener.right, listener.up);
    audio.syncLoopChannels(sndDma.sound.state.channels);
  };
  const writeConfiguration = (): boolean => {
    if (!mainContext) {
      return false;
    }

    const result = CL_WriteConfiguration(mainContext, {
      keyContext: keys,
      getGameDir: () => FS_Gamedir(filesystem),
      onWriteConfigFile: (path, contents) => configStorage.writeText(path, contents),
      onPrint: printToConsole
    });
    return result !== null;
  };
  writeConfigurationNow = writeConfiguration;
  const shutdownClient = (): void => {
    if (!mainContext) {
      return;
    }

    CL_Shutdown(mainContext, {
      keyContext: keys,
      getGameDir: () => FS_Gamedir(filesystem),
      onWriteConfigFile: (path, contents) => configStorage.writeText(path, contents),
      onPrint: printToConsole,
      onCDAudioShutdown: () => {
        cdAudio.stop();
      },
      onSoundShutdown: () => {
        S_DMA_Shutdown(sndDma);
      },
      onInputShutdown: () => {
        IN_Shutdown(inputDevice);
      },
      onVideoShutdown: () => {
        VID_Shutdown(vid);
      }
    });
  };
  const finishConfigBootstrap = (): void => {
    if (!configBootstrapPending) {
      return;
    }

    configBootstrapPending = false;
    const configPath = `${FS_Gamedir(filesystem)}/config.cfg`;
    if (configStorage.readText(configPath) === null) {
      writeConfiguration();
    }
    configAutosaveEnabled = true;
  };
  registerWebConfigCommands(cmd, {
    writeConfiguration,
    onPrint: printToConsole
  });

  return {
    client,
    menu,
    console: consoleContext,
    mouse,
    filesystem,
    configStorage,
    saveStorage,
    canvasRef,
    drawCommands,
    assets,
    audio,
    cdAudio,
    sndDma,
    gameBridge,
    qcommon,
    qcommonHost,
    inputDevice,
    mobileControls: null,
    serverHost,
    get frontendRenderer() {
      return frontendRenderer;
    },
    set frontendRenderer(value) {
      frontendRenderer = value;
    },
    get frontendRendererPromise() {
      return frontendRendererPromise;
    },
    set frontendRendererPromise(value) {
      frontendRendererPromise = value;
    },
    get consoleRenderedInThree() {
      return consoleRenderedInThree;
    },
    set consoleRenderedInThree(value) {
      consoleRenderedInThree = value;
    },
    get gameRenderer() {
      return gameRenderer;
    },
    set gameRenderer(value) {
      gameRenderer = value;
    },
    get gameRendererPromise() {
      return gameRendererPromise;
    },
    set gameRendererPromise(value) {
      gameRendererPromise = value;
    },
    get gameRendererPromiseMapPath() {
      return gameRendererPromiseMapPath;
    },
    set gameRendererPromiseMapPath(value) {
      gameRendererPromiseMapPath = value;
    },
    currentCinematicIndex: 0,
    mode: "cinematic",
    lastFrameTime: 0,
    smoothedFps: 0,
    cinematicStartedAt: 0,
    flushClientOutput,
    updateClientAudio,
    writeConfiguration,
    shutdownClient,
    finishConfigBootstrap,
    captureClipboardText,
    attachMenuRendererRef: (ref) => {
      menuRef.setTarget(ref);
    },
    syncVideoMenuOverlayOrigins: (viewportWidth, viewportHeight) => {
      return videoMenu?.syncMenuOrigins(viewportWidth, viewportHeight) ?? (() => undefined);
    },
    beginAuthoritativeConnection,
    isAuthoritativeLevelLoading: () => authoritativeLevelLoading,
    shouldPumpAuthoritativeFrame,
    pumpAuthoritativeFrame,
    authoritativeGameReady,
    markAuthoritativeGameActive
  };
}

/**
 * Original name: N/A
 * Source: N/A (web console filter)
 * Category: New
 * Purpose: Keep browser console presentation focused by hiding noisy renderer capability lines.
 *
 * Porting notes:
 * - This filters apps/web display output only; it does not replace the ported console implementation.
 */
function shouldSuppressWebAppConsoleLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "Begin() from Player"
    || trimmed.startsWith("ref_gl version:")
    || trimmed.startsWith("GL_VENDOR:")
    || trimmed.startsWith("GL_RENDERER:")
    || trimmed.startsWith("GL_VERSION:")
    || trimmed.startsWith("GL_EXTENSIONS:")
    || trimmed.startsWith("...allowing CDS")
    || trimmed.startsWith("...disabling CDS")
    || trimmed.startsWith("...enabling ")
    || trimmed.startsWith("...using ")
    || trimmed.startsWith("...ignoring ")
    || trimmed.startsWith("...GL_")
    || trimmed.startsWith("...WGL_");
}

/**
 * Original name: N/A
 * Source: N/A (web download adapter)
 * Category: New
 * Purpose: Represent browser-local download writes while client parsing owns the protocol behavior.
 */
type WebDownloadHandle = {
  path: string;
  chunks: Uint8Array[];
};

function createWebDownloadFileHooks(saveStorage: WebSaveStorage): Pick<
  ClientParseHooks,
  "onCreateDownloadPath" | "onOpenDownloadFile" | "onWriteDownloadBytes" | "onCloseDownloadFile" | "onRenameDownloadFile"
> {
  return {
    onCreateDownloadPath: (path) => {
      saveStorage.createPath(path);
    },
    onOpenDownloadFile: (path, mode) => {
      const chunks: Uint8Array[] = [];
      if (mode === "append") {
        const existing = saveStorage.readBinary(path);
        if (existing) {
          chunks.push(existing);
        }
      }
      return { path, chunks } satisfies WebDownloadHandle;
    },
    onWriteDownloadBytes: (handle, bytes) => {
      (handle as WebDownloadHandle).chunks.push(new Uint8Array(bytes));
    },
    onCloseDownloadFile: (handle) => {
      const download = handle as WebDownloadHandle;
      saveStorage.writeBinary(download.path, concatDownloadChunks(download.chunks));
    },
    onRenameDownloadFile: (oldPath, newPath) => {
      const bytes = saveStorage.readBinary(oldPath);
      if (!bytes || !saveStorage.writeBinary(newPath, bytes)) {
        return false;
      }
      saveStorage.remove(oldPath);
      return true;
    }
  };
}

function concatDownloadChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/**
 * Original name: N/A
 * Source: N/A (web audio adapter)
 * Category: New
 * Purpose: Bridge the ported sound DMA state to WebAudio playback, listener data, and debug output.
 *
 * Porting notes:
 * - The sound mixer and client sound ownership stay in packages/client; these functions adapt that state for the browser.
 */
function initializeWebSoundDma(sound: ClientSoundLocalContext, audio: QuakeWebAudioAdapter): boolean {
  const context = audio.context;
  if (!context) {
    return false;
  }

  const speed = getRequestedSoundRate(sound, context.sampleRate);
  const channels = 2;
  const samplebits = 16;
  const frames = Math.max(4096, 1 << Math.ceil(Math.log2(speed * 0.5)));
  const samples = frames * channels;

  sound.state.dma.channels = channels;
  sound.state.dma.samples = samples;
  sound.state.dma.samplebits = samplebits;
  sound.state.dma.speed = speed;
  sound.state.dma.submission_chunk = 1;
  sound.state.dma.samplepos = 0;
  sound.state.dma.buffer = new Uint8Array(samples * (samplebits / 8));
  return true;
}

function getWebSoundDmaPosition(sound: ClientSoundLocalContext, audio: QuakeWebAudioAdapter): number {
  const context = audio.context;
  if (!context || sound.state.dma.samples <= 0 || sound.state.dma.speed <= 0) {
    return sound.state.dma.samplepos;
  }

  const elapsedFrames = Math.trunc(context.currentTime * sound.state.dma.speed);
  sound.state.dma.samplepos = (elapsedFrames * Math.max(1, sound.state.dma.channels)) % sound.state.dma.samples;
  return sound.state.dma.samplepos;
}

/**
 * Original name: N/A
 * Source declaree: N/A (web DMA timing adapter)
 * Category: New
 * Purpose: Convert the browser AudioContext time into the absolute DMA frame used to establish a Quake sound start baseline.
 */
function getWebSoundDmaAbsoluteFrame(sound: ClientSoundLocalContext, audio: QuakeWebAudioAdapter): number {
  const context = audio.context;
  if (!context || sound.state.dma.speed <= 0) {
    return 0;
  }

  return Math.trunc(context.currentTime * sound.state.dma.speed);
}

/**
 * Original name: SCR_EndLoadingPlaque
 * Source declaree: packages/client/src/cl_scrn.ts
 * Category: Adapter
 * Purpose: End the ported loading plaque through its owner so `disable_screen` is cleared with the draw flag.
 */
function clearWebAppLoadingPlaque(client: ClientRuntime): void {
  SCR_EndLoadingPlaque(client);
}

function playIssuedWebSound(context: ClientSndDmaContext, audio: QuakeWebAudioAdapter, ps: playsound_t): void {
  const issued = S_DMA_IssuePlaysound(context, ps);
  if (issued) {
    audio.playChannel(issued);
  }
}

function queueWebAppRawSamples(
  runtime: WebAppRuntime,
  count: number,
  sampleRate: number,
  sampleWidth: number,
  channels: number,
  samples: Uint8Array
): void {
  S_DMA_RawSamples(runtime.sndDma, count, sampleRate, sampleWidth, channels, samples);
  runtime.audio.queueRawSamples(count, sampleRate, sampleWidth, channels, samples);
}

function activateWebAppSound(runtime: WebAppRuntime, active: boolean): void {
  if (active) {
    void runtime.audio.resume().catch(() => undefined);
    return;
  }

  void runtime.audio.pause().catch(() => undefined);
}

function buildWebAppAudioListener(client: ClientRuntime): {
  origin: [number, number, number];
  forward: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
} {
  if (client.cls.state === connstate_t.ca_active && client.cl.frame.valid) {
    CL_UpdateLerpFraction(client, { predictMovement: true });
    const view = CL_CalcViewValues(client, { predictMovement: true });
    return {
      origin: view.vieworg,
      forward: view.forward,
      right: view.right,
      up: view.up
    };
  }

  const vectors = AngleVectors(client.cl.viewangles);
  return {
    origin: [...client.cl.predicted_origin],
    forward: vectors.forward,
    right: vectors.right,
    up: vectors.up
  };
}

function isSfx(value: unknown): value is sfx_t {
  return (
    typeof value === "object"
    && value !== null
    && "name" in value
    && typeof (value as { name?: unknown }).name === "string"
  );
}

function getRequestedSoundRate(sound: ClientSoundLocalContext, fallback: number): number {
  const khz = Math.trunc(sound.state.s_khz?.value ?? 11);
  if (khz >= 44) {
    return 44100;
  }
  if (khz >= 22) {
    return 22050;
  }
  if (khz >= 11) {
    return 11025;
  }
  return Math.max(11025, Math.trunc(fallback));
}

/**
 * Original name: N/A
 * Source: N/A (web config bootstrap)
 * Category: New
 * Purpose: Seed browser-host defaults and commands needed before user config files can run.
 *
 * Porting notes:
 * - Uses qcommon/client command and cvar ports instead of replacing their ownership.
 */
function queueWebAppConfigBootstrap(cmd: ReturnType<typeof createCommandRuntime>): void {
  Cbuf_AddText(cmd, "exec default.cfg\n");
  Cbuf_AddText(cmd, "bind 1 \"use Blaster\"\n");
  Cbuf_AddText(cmd, "bind 2 \"use Shotgun\"\n");
  Cbuf_AddText(cmd, "bind 3 \"use Super Shotgun\"\n");
  Cbuf_AddText(cmd, "bind 4 \"use Machinegun\"\n");
  Cbuf_AddText(cmd, "bind 5 \"use Chaingun\"\n");
  Cbuf_AddText(cmd, "bind 6 \"use Grenade Launcher\"\n");
  Cbuf_AddText(cmd, "bind 7 \"use Rocket Launcher\"\n");
  Cbuf_AddText(cmd, "bind 8 \"use HyperBlaster\"\n");
  Cbuf_AddText(cmd, "bind 9 \"use Railgun\"\n");
  Cbuf_AddText(cmd, "bind 0 \"use BFG10K\"\n");
  Cbuf_AddText(cmd, "bind g \"use grenades\"\n");
  Cbuf_AddText(cmd, "bind w +forward\n");
  Cbuf_AddText(cmd, "bind s +back\n");
  Cbuf_AddText(cmd, "bind a +moveleft\n");
  Cbuf_AddText(cmd, "bind d +moveright\n");
  Cbuf_AddText(cmd, "bind z +forward\n");
  Cbuf_AddText(cmd, "bind q +moveleft\n");
  Cbuf_AddText(cmd, "exec config.cfg\n");
  Cbuf_AddText(cmd, "exec autoexec.cfg\n");
}

function registerWebAppToggleConsoleCommand(
  cmd: ReturnType<typeof createCommandRuntime>,
  handler: () => void
): void {
  if (Cmd_Exists(cmd, "toggleconsole")) {
    Cmd_RemoveCommand(cmd, "toggleconsole");
  }
  Cmd_AddCommand(cmd, "toggleconsole", handler);
}

function seedMenuCvars(cvar: ReturnType<typeof createCvarRuntime>): void {
  Cvar_Get(cvar, "maxclients", "1", 0);
  Cvar_Get(cvar, "paused", "0", 0);
  Cvar_Get(cvar, "deathmatch", "0", 0);
  Cvar_Get(cvar, "coop", "0", 0);
  Cvar_Get(cvar, "gamerules", "0", 0);
  Cvar_Get(cvar, "skill", "1", 0);
  Cvar_Get(cvar, "name", "Player", CVAR_ARCHIVE);
  Cvar_Get(cvar, "skin", "male/grunt", CVAR_ARCHIVE);
  Cvar_Get(cvar, "hand", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "rate", "25000", CVAR_ARCHIVE);
  Cvar_Get(cvar, "s_volume", "0.7", CVAR_ARCHIVE);
  Cvar_Get(cvar, "lookspring", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "lookstrafe", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "freelook", "1", CVAR_ARCHIVE);
  Cvar_Get(cvar, "crosshair", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "gl_polyblend", "1", CVAR_ARCHIVE);
  Cvar_Get(cvar, "gl_shadows", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "in_joystick", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "cd_nocd", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "s_khz", "22", CVAR_ARCHIVE);
  Cvar_Get(cvar, "s_loadas8bit", "1", CVAR_ARCHIVE);
  Cvar_Get(cvar, "s_primary", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "vid_ref", "gl", CVAR_ARCHIVE);
  Cvar_Get(cvar, "vid_fullscreen", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "vid_gamma", "1", CVAR_ARCHIVE);
  Cvar_Get(cvar, "intensity", "2", 0);
  Cvar_Get(cvar, "viewsize", "100", CVAR_ARCHIVE);
  Cvar_Get(cvar, "gl_driver", "opengl32", CVAR_ARCHIVE);
  Cvar_Get(cvar, "gl_picmip", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "gl_mode", "3", CVAR_ARCHIVE);
  Cvar_Get(cvar, "gl_ext_palettedtexture", "1", CVAR_ARCHIVE);
  Cvar_Get(cvar, "gl_finish", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "sw_mode", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "sw_stipplealpha", "0", CVAR_ARCHIVE);
  Cvar_Get(cvar, "win_noalttab", "0", CVAR_ARCHIVE);
}

/**
 * Original name: N/A
 * Source: N/A (web canvas ref adapter)
 * Category: New
 * Purpose: Capture refexport_t draw calls into the browser canvas command queue.
 */
function createCanvasRef(
  filesystem: VirtualFilesystem,
  assets: CanvasAssetCache,
  commands: DrawCommand[]
): refexport_t {
  const ref = createRefExport();
  ref.RegisterPic = (name) => loadPictureCanvas(filesystem, assets, name);
  ref.DrawGetPicSize = (name) => {
    const image = loadPictureCanvas(filesystem, assets, name);
    return image ? { width: image.width, height: image.height } : { width: 0, height: 0 };
  };
  ref.DrawPic = (x, y, name) => {
    commands.push({ type: "pic", x, y, name });
  };
  ref.DrawStretchPic = (x, y, width, height, name) => {
    commands.push({ type: "pic", x, y, width, height, name });
  };
  ref.DrawChar = (x, y, code) => {
    commands.push({ type: "char", x, y, code });
  };
  ref.DrawFill = (x, y, width, height, color) => {
    commands.push({ type: "fill", x, y, width, height, color });
  };
  ref.DrawStretchRaw = (x, y, width, height, cols, rows, data) => {
    commands.push({ type: "raw", x, y, width, height, cols, rows, data });
  };
  ref.CinematicSetPalette = (palette) => {
    assets.paletteRgb = palette ? palette.slice() : null;
  };
  ref.DrawFadeScreen = () => {
    commands.push({ type: "fade" });
  };
  return ref;
}

function createMirroredMenuRef(canvasRef: refexport_t): WebAppMenuRef {
  let target: refexport_t | null = null;
  const ref = createRefExport() as WebAppMenuRef;

  ref.setTarget = (nextTarget) => {
    target = nextTarget;
  };
  ref.Init = (hinstance, wndproc) => target?.Init(hinstance, wndproc) ?? canvasRef.Init(hinstance, wndproc);
  ref.Shutdown = () => {
    target?.Shutdown();
    canvasRef.Shutdown();
  };
  ref.BeginRegistration = (map) => {
    target?.BeginRegistration(map);
    canvasRef.BeginRegistration(map);
  };
  ref.RegisterModel = (name) => target?.RegisterModel(name) ?? canvasRef.RegisterModel(name);
  ref.RegisterSkin = (name) => target?.RegisterSkin(name) ?? canvasRef.RegisterSkin(name);
  ref.RegisterPic = (name) => target?.RegisterPic(name) ?? canvasRef.RegisterPic(name);
  ref.SetSky = (name, rotate, axis) => {
    target?.SetSky(name, rotate, axis);
    canvasRef.SetSky(name, rotate, axis);
  };
  ref.EndRegistration = () => {
    target?.EndRegistration();
    canvasRef.EndRegistration();
  };
  ref.RenderFrame = (fd) => {
    target?.RenderFrame(fd);
    canvasRef.RenderFrame(fd);
  };
  ref.DrawGetPicSize = (name) => {
    const targetSize = target?.DrawGetPicSize(name);
    if (targetSize && targetSize.width > 0 && targetSize.height > 0) {
      return targetSize;
    }
    return canvasRef.DrawGetPicSize(name);
  };
  ref.DrawPic = (x, y, name) => {
    target?.DrawPic(x, y, name);
    canvasRef.DrawPic(x, y, name);
  };
  ref.DrawStretchPic = (x, y, width, height, name) => {
    target?.DrawStretchPic(x, y, width, height, name);
    canvasRef.DrawStretchPic(x, y, width, height, name);
  };
  ref.DrawChar = (x, y, c) => {
    target?.DrawChar(x, y, c);
    canvasRef.DrawChar(x, y, c);
  };
  ref.DrawTileClear = (x, y, width, height, name) => {
    target?.DrawTileClear(x, y, width, height, name);
    canvasRef.DrawTileClear(x, y, width, height, name);
  };
  ref.DrawFill = (x, y, width, height, c) => {
    target?.DrawFill(x, y, width, height, c);
    canvasRef.DrawFill(x, y, width, height, c);
  };
  ref.DrawFadeScreen = () => {
    target?.DrawFadeScreen();
    canvasRef.DrawFadeScreen();
  };
  ref.DrawStretchRaw = (x, y, width, height, cols, rows, data) => {
    target?.DrawStretchRaw(x, y, width, height, cols, rows, data);
    canvasRef.DrawStretchRaw(x, y, width, height, cols, rows, data);
  };
  ref.CinematicSetPalette = (palette) => {
    target?.CinematicSetPalette(palette);
    canvasRef.CinematicSetPalette(palette);
  };
  ref.BeginFrame = (cameraSeparation) => {
    target?.BeginFrame(cameraSeparation);
    canvasRef.BeginFrame(cameraSeparation);
  };
  ref.EndFrame = () => {
    target?.EndFrame();
    canvasRef.EndFrame();
  };
  ref.AppActivate = (activate) => {
    target?.AppActivate(activate);
    canvasRef.AppActivate(activate);
  };

  return ref;
}

function tryPlayWebAppCinematic(
  client: ClientRuntime,
  name: string,
  hooks: ClientScreenHooks & { onError?: (message: string) => void }
): boolean {
  try {
    return SCR_PlayCinematic(client, name, hooks);
  } catch (error) {
    SCR_StopCinematic(client, hooks);
    SCR_FinishCinematic(client);
    hooks.onError?.(error instanceof Error ? error.message : `${error}`);
    return false;
  }
}

/**
 * Original name: N/A
 * Source: N/A (web web-app loop)
 * Category: New
 * Purpose: Advance the browser startup cinematic sequence through the ported cinematic runtime.
 */
function startNextCinematic(runtime: WebAppRuntime, page: WebAppPage): void {
  if (runtime.currentCinematicIndex >= STARTUP_CINEMATICS.length) {
    enterMainMenu(runtime, page);
    return;
  }

  const name = STARTUP_CINEMATICS[runtime.currentCinematicIndex];
  runtime.client.cls.realtime = performance.now();
  runtime.cinematicStartedAt = runtime.client.cls.realtime;
  runtime.mode = "cinematic";
  const started = tryPlayWebAppCinematic(runtime.client, name, {
    loadBinaryFile: (path) => readMountedFile(runtime.filesystem, path)?.bytes ?? null,
    onCinematicRawSamples: (count, sampleRate, sampleWidth, channels, samples) => {
      queueWebAppRawSamples(runtime, count, sampleRate, sampleWidth, channels, samples);
    },
    onCinematicSoundRestart: () => {
      runtime.audio.stopRaw();
    },
    onCDAudioStop: () => {
      runtime.cdAudio.stop();
    },
    onError: (message) => Con_Print(runtime.console.con, `cinematique ignoree ${name}: ${message}\n`, runtime.client.cls.realtime)
  });

  if (!started) {
    Con_Print(runtime.console.con, `cinematique introuvable: ${name}\n`, runtime.client.cls.realtime);
    Con_SyncConsoleToKeys(runtime.console);
    runtime.currentCinematicIndex += 1;
    startNextCinematic(runtime, page);
    return;
  }

  page.status.textContent = `Cinematique ${runtime.currentCinematicIndex + 1}/${STARTUP_CINEMATICS.length}: ${name}`;
  page.status.style.display = "block";
}

function startWebAppAttractLoop(runtime: WebAppRuntime, page: WebAppPage): void {
  const media = buildAvailableAttractLoopMedia(runtime.filesystem);
  if (media.length === 0) {
    enterMainMenu(runtime, page);
    return;
  }

  runtime.mode = "loading";
  runtime.menu.keys.state.key_dest = keydest_t.key_game;
  runtime.client.cls.state = connstate_t.ca_disconnected;
  for (let index = 0; index < media.length; index += 1) {
    const alias = `q2js_d${index + 1}`;
    const nextAlias = `q2js_d${((index + 1) % media.length) + 1}`;
    Cbuf_AddText(runtime.menu.cmd, `alias ${alias} "demomap ${media[index]} ; set nextserver ${nextAlias}"\n`);
  }
  Cbuf_AddText(runtime.menu.cmd, "q2js_d1\n");
  executeRuntimeCommandBuffer(runtime, page);
  if (runtime.serverHost.hasActiveAttractLoop()) {
    runtime.beginAuthoritativeConnection("__attractloop");
  }
  page.status.textContent = "Boucle de demonstration Quake II.";
  page.status.style.display = "block";
}

/**
 * Original name: N/A
 * Source: N/A (web attract-loop adapter)
 * Category: New
 * Purpose: Build an attract-loop sequence only from media present in the mounted demo/full assets.
 *
 * Constraints:
 * - Must avoid hard-coding retail demo names when the shareware pack only provides `q2demo1.dm2`.
 * - Must pass `.dm2` names exactly as `SV_BeginDemoserver` expects under `demos/`.
 */
function buildAvailableAttractLoopMedia(filesystem: VirtualFilesystem): string[] {
  const media: string[] = [];

  for (const cinematic of STARTUP_CINEMATICS) {
    if (isPlayableAttractLoopCinematic(filesystem, cinematic)) {
      media.push(cinematic);
    }
  }

  for (const demo of ["q2demo1.dm2", "demo1.dm2", "demo2.dm2"]) {
    if (isCompatibleAttractLoopDemo(filesystem, demo)) {
      media.push(demo);
    }
  }

  return media;
}

function isPlayableAttractLoopCinematic(filesystem: VirtualFilesystem, cinematic: string): boolean {
  const file = readMountedFile(filesystem, `video/${cinematic}`);
  if (!file) {
    return false;
  }

  return file.bytes.length >= 20 + 256 * 256;
}

/**
 * Original name: N/A
 * Source: N/A (web attract-loop adapter)
 * Category: New
 * Purpose: Skip bundled demos recorded with an unsupported Quake II network protocol.
 *
 * Constraints:
 * - Must inspect the mounted `.dm2` payload before queueing `demomap`; otherwise an old shareware
 *   demo can crash the first browser frame with "Server returned version 31, not 34".
 */
function isCompatibleAttractLoopDemo(filesystem: VirtualFilesystem, demo: string): boolean {
  const file = readMountedFile(filesystem, `demos/${demo}`);
  if (!file || file.bytes.length < 9) {
    return false;
  }

  const view = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
  const messageLength = view.getInt32(0, true);
  if (messageLength < 5 || messageLength + 4 > file.bytes.length) {
    return false;
  }

  const payloadOffset = 4;
  if (file.bytes[payloadOffset] !== svc_ops_e.svc_serverdata) {
    return false;
  }

  const protocol = view.getInt32(payloadOffset + 1, true);
  return protocol === PROTOCOL_VERSION || protocol === 26;
}

/**
 * Original name: N/A
 * Source: N/A (web command bridge adapter)
 * Category: New
 * Purpose: Select a legal single-player start map for the mounted asset set.
 *
 * Constraints:
 * - Must preserve the retail Quake II start command when `base1.bsp` is present.
 * - Must let the public shareware deployment start from `demo1.bsp` instead of crashing on missing retail assets.
 */
function selectWebAppNewGameMap(filesystem: VirtualFilesystem): string {
  if (readMountedFile(filesystem, "maps/base1.bsp")) {
    return "*base1";
  }

  if (readMountedFile(filesystem, "maps/demo1.bsp")) {
    return "*demo1";
  }

  return "*base1";
}

/**
 * Original name: N/A
 * Source: N/A (web web-app loop)
 * Category: New
 * Purpose: Switch the browser host to the ported Quake II main menu.
 */
function enterMainMenu(runtime: WebAppRuntime, page: WebAppPage): void {
  releaseWebAppMouseLook(runtime, page);
  runtime.mode = "menu";
  if (!runtime.serverHost.hasActiveGameMap()) {
    runtime.client.cls.state = connstate_t.ca_disconnected;
  }
  runtime.menu.keys.state.key_dest = keydest_t.key_menu;
  M_Menu_Main_f(runtime.menu);
  page.status.textContent = "Menu principal Quake II.";
  page.status.style.display = "none";
}

/**
 * Original name: N/A
 * Source: N/A (web web-app loop)
 * Category: New
 * Purpose: Drive the browser animation frame around the ported qcommon/client/server frame flow.
 */
function frame(time: number, runtime: WebAppRuntime, page: WebAppPage): void {
  const delta = runtime.lastFrameTime === 0 ? 0 : time - runtime.lastFrameTime;
  runtime.lastFrameTime = time;
  runtime.client.cls.realtime = time;
  executeRuntimeCommandBuffer(runtime, page);
  // Per frame, not only on key events. A client that joins over the network
  // reaches ca_active with no key pressed, and every other caller of this is a
  // keyboard handler -- so without this the menu stayed up over a running match
  // until the player happened to press something.
  syncWebAppKeyDestination(runtime, page);
  if (runtime.shouldPumpAuthoritativeFrame()) {
    runtime.pumpAuthoritativeFrame(delta);
  } else {
    runtime.client.cls.frametime = delta / 1000;
    runtime.client.cls.framecount += 1;
  }
  runtime.updateClientAudio();
  executeRuntimeCommandBuffer(runtime, page);
  runtime.consoleRenderedInThree = false;
  syncWebAppViewportVisibility(runtime, page);

  clearCanvas(page);

  if (shouldDrawWebAppLoadingFrame(runtime)) {
    drawLoadingFrame(runtime, page);
  } else if (runtime.mode === "cinematic") {
    drawCinematicFrame(runtime, page);
  } else if (runtime.mode === "game") {
    drawGameFrame(runtime, page, delta / 1000);
  } else if (shouldDrawAttractLoopMenuOverlay(runtime)) {
    drawGameFrame(runtime, page, delta / 1000);
  } else if (runtime.mode === "loading") {
    if (!shouldHideAttractLoopLoading(runtime)) {
      drawLoadingFrame(runtime, page);
    }
  } else {
    drawMenuFrame(runtime, page);
  }

  if (runtime.menu.keys.state.key_dest === keydest_t.key_console
    && !runtime.consoleRenderedInThree) {
    page.status.style.display = "none";
    page.canvas.style.display = "block";
    drawConsoleFrame(runtime, page);
  }

  if (page.perfHudEnabled) {
    updateWebAppPerfHud(runtime, page, delta);
  }
  runtime.mobileControls?.update();
  requestAnimationFrame((nextTime) => frame(nextTime, runtime, page));
}

function updateWebAppPerfHud(runtime: WebAppRuntime, page: WebAppPage, deltaMilliseconds: number): void {
  if (deltaMilliseconds > 0) {
    const instantFps = 1000 / deltaMilliseconds;
    runtime.smoothedFps = runtime.smoothedFps === 0
      ? instantFps
      : runtime.smoothedFps * 0.9 + instantFps * 0.1;
  }

  page.perfHud.textContent = `${getActiveWebAppRendererLabel(runtime, page)} | ${Math.round(runtime.smoothedFps || 0)} FPS`;
}

function getActiveWebAppRendererLabel(runtime: WebAppRuntime, page: WebAppPage): string {
  if (page.gameViewport.style.display !== "none" && runtime.gameRenderer) {
    return runtime.gameRenderer.rendererLabel;
  }

  if (page.frontendViewport.style.display !== "none" && runtime.frontendRenderer) {
    return runtime.frontendRenderer.rendererLabel;
  }

  return runtime.frontendRenderer?.rendererLabel ?? runtime.gameRenderer?.rendererLabel ?? "Canvas";
}

function shouldDrawWebAppLoadingFrame(runtime: WebAppRuntime): boolean {
  if (runtime.menu.keys.state.key_dest === keydest_t.key_console) {
    return false;
  }

  if (shouldHideAttractLoopLoading(runtime)) {
    return false;
  }

  return runtime.isAuthoritativeLevelLoading()
    || runtime.client.cl.screen.scr_draw_loading !== 0;
}

function shouldDrawAttractLoopMenuOverlay(runtime: WebAppRuntime): boolean {
  return runtime.mode === "menu"
    && runtime.menu.keys.state.key_dest === keydest_t.key_menu
    && (runtime.serverHost.hasActiveAttractLoop() || runtime.serverHost.hasActiveGameMap())
    && runtime.client.cls.state === connstate_t.ca_active
    && runtime.client.cl.refresh_prepped;
}

function shouldHideAttractLoopLoading(runtime: WebAppRuntime): boolean {
  return runtime.serverHost.hasActiveAttractLoop()
    && runtime.menu.keys.state.key_dest !== keydest_t.key_console;
}

/**
 * Original name: N/A
 * Source: N/A (web web-app loop)
 * Category: New
 * Purpose: Execute pending Quake commands and reflect loading/game transitions into the web host.
 */
function executeRuntimeCommandBuffer(runtime: WebAppRuntime, page: WebAppPage): void {
  Cbuf_Execute(runtime.menu.cmd);
  runtime.finishConfigBootstrap();
  const enteredLoading = syncWebAppLoadingState(runtime.client, runtime.gameBridge, {
    onBeginLoading: () => {
      runtime.mode = "loading";
    },
    onPrint: (message) => {
      Con_Print(runtime.console.con, `${message}\n`, runtime.client.cls.realtime);
      Con_SyncConsoleToKeys(runtime.console);
    }
  });
  runtime.flushClientOutput();
  runtime.updateClientAudio();

  if (runtime.serverHost.hasActiveServerMedia() && runtime.client.cl.cinematic.cinematictime > 0) {
    if (runtime.mode !== "cinematic") {
      runtime.cinematicStartedAt = runtime.client.cls.realtime;
    }
    runtime.markAuthoritativeGameActive();
    runtime.mode = "cinematic";
    clearWebAppLoadingPlaque(runtime.client);
    if (runtime.serverHost.hasActiveAttractLoop()) {
      page.status.textContent = "Boucle de demonstration Quake II.";
      page.status.style.display = "block";
    } else {
      page.status.textContent = "";
      page.status.style.display = "none";
    }
    return;
  }

  if (runtime.isAuthoritativeLevelLoading() && !runtime.authoritativeGameReady()) {
    runtime.mode = "loading";
    if (runtime.serverHost.hasActiveAttractLoop()) {
      page.status.textContent = "";
      page.status.style.display = "none";
    } else {
      page.status.textContent = "Chargement du niveau...";
      page.status.style.display = "block";
    }
    return;
  }

  if (runtime.gameBridge.requestedMap) {
    const requestedMap = runtime.gameBridge.requestedMap;
    if (runtime.serverHost.hasActiveGameMap()) {
      runtime.beginAuthoritativeConnection(requestedMap);
    }

    if (runtime.authoritativeGameReady()) {
      runtime.markAuthoritativeGameActive();
      syncWebAppActiveView(runtime, page, `Jeu actif: ${runtime.serverHost.currentMapRequest ?? requestedMap}.`);
    } else {
      runtime.mode = "loading";
      page.status.textContent = `Preparation de ${requestedMap}.`;
      page.status.style.display = "block";
    }
  } else if (runtime.serverHost.hasActiveServer() && runtime.authoritativeGameReady()) {
    runtime.markAuthoritativeGameActive();
    syncWebAppActiveView(runtime, page, "");
  } else if (runtime.gameBridge.phase === "loading" || enteredLoading) {
    page.status.textContent = "Chargement du jeu...";
    page.status.style.display = "block";
  }
}

/**
 * Original name: N/A
 * Source: N/A (web web-app loop)
 * Category: New
 * Purpose: Keep the browser mode and status text aligned with the authoritative game/menu state.
 */
function syncWebAppActiveView(runtime: WebAppRuntime, page: WebAppPage, gameStatus: string): void {
  if (runtime.menu.keys.state.key_dest === keydest_t.key_menu) {
    runtime.mode = "menu";
    page.status.textContent = "Menu principal Quake II.";
    page.status.style.display = "none";
    return;
  }

  runtime.mode = "game";
  page.status.textContent = gameStatus;
  page.status.style.display = "none";
}

/**
 * Original name: N/A
 * Source: N/A (web render orchestration)
 * Category: New
 * Purpose: Render one cinematic frame through the ported client cinematic draw path.
 */
function drawCinematicFrame(runtime: WebAppRuntime, page: WebAppPage): void {
  const wasActive = runtime.client.cl.cinematic.cinematictime > 0;
  SCR_RunCinematic(runtime.client, {
    keyDest: "game",
    currentTimeMs: runtime.client.cls.realtime
  }, {
    loadBinaryFile: (path) => readMountedFile(runtime.filesystem, path)?.bytes ?? null,
    onCinematicRawSamples: (count, sampleRate, sampleWidth, channels, samples) => {
      queueWebAppRawSamples(runtime, count, sampleRate, sampleWidth, channels, samples);
    },
    onCinematicSoundRestart: () => {
      runtime.audio.stopRaw();
    },
    onCDAudioStop: () => {
      runtime.cdAudio.stop();
    }
  });

  runtime.drawCommands.length = 0;
  SCR_DrawCinematicRef(runtime.client, runtime.canvasRef, {
    viewportWidth: LOGICAL_WIDTH,
    viewportHeight: LOGICAL_HEIGHT,
    keyDest: "game"
  });
  drawCapturedCommands(page, runtime);

  if (wasActive && runtime.client.cl.cinematic.cinematictime <= 0) {
    if (runtime.serverHost.hasActiveServerMedia()) {
      runtime.audio.stopRaw();
      runtime.mode = "loading";
      if (runtime.serverHost.hasActiveAttractLoop()) {
        clearWebAppLoadingPlaque(runtime.client);
      }
      return;
    }

    runtime.currentCinematicIndex += 1;
    startNextCinematic(runtime, page);
  }
}

/**
 * Original name: N/A
 * Source: N/A (web render orchestration)
 * Category: New
 * Purpose: Render the ported menu either through the frontend ref_gl adapter or the canvas fallback.
 */
function drawMenuFrame(runtime: WebAppRuntime, page: WebAppPage): void {
  runtime.drawCommands.length = 0;
  runtime.menu.qmenu.state.drawChars.length = 0;
  runtime.menu.qmenu.state.drawFills.length = 0;
  runtime.menu.qmenu.state.drawStrings.length = 0;

  const renderer = runtime.frontendRenderer;
  if (renderer) {
    resizeWebAppFrontendRenderer(page, renderer);
    renderer.glDrawAdapter.clear();
  }

  if (runtime.menu.keys.state.key_dest === keydest_t.key_console) {
    page.status.style.display = "none";
  } else {
    page.status.style.display = "none";
    M_Draw(runtime.menu);
  }

  if (!renderer) {
    drawCapturedCommands(page, runtime);
    return;
  }

  renderer.renderer.autoClear = true;
  renderer.renderer.clear();
  renderer.renderer.render(renderer.glDrawAdapter.scene, renderer.glDrawAdapter.camera);
}

/**
 * Original name: N/A
 * Source: N/A (web render orchestration)
 * Category: New
 * Purpose: Render the ported loading plaque through the active frontend renderer or canvas fallback.
 */
function drawLoadingFrame(runtime: WebAppRuntime, page: WebAppPage): void {
  runtime.drawCommands.length = 0;
  const loadingCommand = SCR_DrawLoading(runtime.client) ?? createWebAppAutosizedPictureCommand("loading");
  const renderer = runtime.frontendRenderer;
  renderer?.glDrawAdapter.clear();

  if (!renderer) {
    drawCenteredPicture(page, runtime, loadingCommand.pic);
    return;
  }

  resizeWebAppFrontendRenderer(page, renderer);
  drawWebAppPictureRef(
    renderer.ref,
    loadingCommand,
    LOGICAL_WIDTH,
    LOGICAL_HEIGHT
  );
  renderer.renderer.autoClear = true;
  renderer.renderer.clear();
  renderer.renderer.render(renderer.glDrawAdapter.scene, renderer.glDrawAdapter.camera);
}

/**
 * Original name: N/A
 * Source: N/A (web render orchestration)
 * Category: New
 * Purpose: Center or stretch a client picture command through a refexport_t draw target.
 */
function drawWebAppPictureRef(
  ref: refexport_t,
  command: ClientHudPictureCommand,
  viewportWidth: number,
  viewportHeight: number
): void {
  const requestedWidth = command.bounds.width;
  const requestedHeight = command.bounds.height;
  const needsSize = requestedWidth <= 0 || requestedHeight <= 0 || command.x < 0 || command.y < 0;
  const nativeSize = needsSize ? ref.DrawGetPicSize(command.pic) : { width: requestedWidth, height: requestedHeight };
  const width = requestedWidth > 0 ? requestedWidth : nativeSize.width;
  const height = requestedHeight > 0 ? requestedHeight : nativeSize.height;
  const x = command.x < 0 ? (viewportWidth - width) / 2 : command.x;
  const y = command.y < 0 ? (viewportHeight - height) / 2 : command.y;

  if (requestedWidth > 0 && requestedHeight > 0) {
    ref.DrawStretchPic(x, y, requestedWidth, requestedHeight, command.pic);
    return;
  }

  ref.DrawPic(x, y, command.pic);
}

/**
 * Original name: N/A
 * Source: N/A (web render orchestration)
 * Category: New
 * Purpose: Build the web fallback picture command used when the ported screen layer has no pending plaque.
 */
function createWebAppAutosizedPictureCommand(pic: string): ClientHudPictureCommand {
  return {
    type: "picture",
    x: -1,
    y: -1,
    pic,
    bounds: {
      x: -1,
      y: -1,
      width: 0,
      height: 0
    }
  };
}

interface MenuOverlayFrameworkOrigin {
  menu: menuframework_s;
  x: number;
  y: number;
}

/**
 * Original name: N/A
 * Source: N/A (web viewport adapter)
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Keep active `client/menu.c` framework origins aligned with the overlay `viddef`.
 *
 * Porting notes:
 * - Mirrors the original `*_MenuInit` positioning formulas from `client/menu.c`.
 * - The browser overlay can change `viddef` between menu init and draw; the C renderer used one
 *   consistent `viddef` for both.
 * - Returns the prior origins so the temporary overlay coordinate system does not leak back into
 *   the regular 640x480 frontend menu.
 */
function syncMenuOverlayFrameworkOrigins(
  context: ClientMenuContext,
  viewportWidth: number,
  viewportHeight: number
): MenuOverlayFrameworkOrigin[] {
  const state = context.state;
  const centerX = viewportWidth * 0.5;
  const origins = [
    state.s_game_menu,
    state.s_multiplayer_menu,
    state.s_keys_menu,
    state.s_startserver_menu,
    state.s_dmoptions_menu,
    state.s_downloadoptions_menu,
    state.s_joinserver_menu,
    state.s_options_menu,
    state.s_loadgame_menu,
    state.s_savegame_menu,
    state.s_addressbook_menu,
    state.s_player_config_menu
  ].map((menu) => ({ menu, x: menu.x, y: menu.y }));

  context.qmenu.state.vidWidth = viewportWidth;
  context.qmenu.state.vidHeight = viewportHeight;

  state.s_game_menu.x = centerX;
  Menu_Center(context.qmenu, state.s_game_menu);

  state.s_multiplayer_menu.x = centerX - 64;
  Menu_Center(context.qmenu, state.s_multiplayer_menu);

  state.s_keys_menu.x = centerX;
  Menu_Center(context.qmenu, state.s_keys_menu);

  state.s_startserver_menu.x = centerX;
  Menu_Center(context.qmenu, state.s_startserver_menu);

  state.s_dmoptions_menu.x = centerX;
  Menu_Center(context.qmenu, state.s_dmoptions_menu);

  state.s_downloadoptions_menu.x = centerX;
  Menu_Center(context.qmenu, state.s_downloadoptions_menu);

  state.s_joinserver_menu.x = centerX - 120;
  Menu_Center(context.qmenu, state.s_joinserver_menu);

  state.s_options_menu.x = Math.trunc(viewportWidth / 2);
  state.s_options_menu.y = Math.trunc(viewportHeight / 2 - 58);

  state.s_loadgame_menu.x = Math.trunc(viewportWidth / 2 - 120);
  state.s_loadgame_menu.y = Math.trunc(viewportHeight / 2 - 58);

  state.s_savegame_menu.x = Math.trunc(viewportWidth / 2 - 120);
  state.s_savegame_menu.y = Math.trunc(viewportHeight / 2 - 58);

  state.s_addressbook_menu.x = Math.trunc(viewportWidth / 2 - 142);
  state.s_addressbook_menu.y = Math.trunc(viewportHeight / 2 - 58);

  state.s_player_config_menu.x = Math.trunc(viewportWidth / 2 - 95);
  state.s_player_config_menu.y = Math.trunc(viewportHeight / 2 - 97);

  return origins;
}

/**
 * Original name: N/A
 * Source: N/A (web viewport adapter)
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Restore menu framework origins after an in-game overlay draw.
 */
function restoreMenuOverlayFrameworkOrigins(origins: MenuOverlayFrameworkOrigin[]): void {
  for (const origin of origins) {
    origin.menu.x = origin.x;
    origin.menu.y = origin.y;
  }
}

/**
 * Original name: N/A
 * Source: N/A (web render orchestration)
 * Category: New
 * Purpose: Feed authoritative client render data into the Three/ref_gl web-app renderer.
 */
function drawGameFrame(runtime: WebAppRuntime, page: WebAppPage, deltaSeconds: number): void {
  if (runtime.menu.keys.state.key_dest === keydest_t.key_console) {
    page.status.style.display = "none";
  }

  if (!runtime.authoritativeGameReady()) {
    if (runtime.menu.keys.state.key_dest !== keydest_t.key_console) {
      page.status.textContent = "Preparation du jeu...";
      page.status.style.display = "block";
    }
    return;
  }

  const mapPath = getAuthoritativeMapPath(runtime);
  if (!mapPath) {
    page.status.textContent = "Carte serveur indisponible.";
    page.status.style.display = "block";
    return;
  }

  const renderer = ensureWebAppRenderer(runtime, page, mapPath);
  if (!renderer) {
    page.status.style.display = "none";
    drawLoadingFrame(runtime, page);
    return;
  }

  page.status.style.display = "none";
  const source = createWebAppServerRenderSource(runtime.client, {
    cvar: runtime.menu.cvar,
    predictMovement: !runtime.serverHost.hasActiveAttractLoop()
  });
  syncThreeCameraToRefresh(renderer.camera, source.refreshFrame);
  const consoleCanvas = runtime.menu.keys.state.key_dest === keydest_t.key_console
    ? prepareConsoleCanvasOverlay(runtime, page, renderer)
    : null;
  const drawAttractLoopMenu = shouldDrawAttractLoopMenuOverlay(runtime);
  if (drawAttractLoopMenu && !renderer.menuOverlayPicsWarmed) {
    warmWebAppMenuPics(renderer.ref);
    renderer.menuOverlayPicsWarmed = true;
  }
  renderer.renderLoop.renderFrame({
    source,
    elapsedSeconds: runtime.client.cl.time * 0.001,
    ...(consoleCanvas ? { canvasOverlay: consoleCanvas } : {}),
    ...(drawAttractLoopMenu
      ? {
          drawOverlay: ({ viewportWidth, viewportHeight }) => {
            drawMenuOverlayRef(runtime, renderer.ref, viewportWidth, viewportHeight);
          }
        }
      : {})
  });
  runtime.consoleRenderedInThree = consoleCanvas !== null;
}

function drawMenuOverlayRef(runtime: WebAppRuntime, ref: refexport_t, viewportWidth: number, viewportHeight: number): void {
  runtime.drawCommands.length = 0;
  runtime.menu.qmenu.state.drawChars.length = 0;
  runtime.menu.qmenu.state.drawFills.length = 0;
  runtime.menu.qmenu.state.drawStrings.length = 0;

  const previousWidth = runtime.menu.vid.viddef.width;
  const previousHeight = runtime.menu.vid.viddef.height;
  runtime.menu.vid.viddef.width = viewportWidth;
  runtime.menu.vid.viddef.height = viewportHeight;
  const previousMenuOrigins = syncMenuOverlayFrameworkOrigins(runtime.menu, viewportWidth, viewportHeight);
  const restoreVideoMenuOrigins = runtime.syncVideoMenuOverlayOrigins(viewportWidth, viewportHeight);
  runtime.attachMenuRendererRef(ref);
  try {
    if (runtime.menu.keys.state.key_dest === keydest_t.key_menu) {
      M_Draw(runtime.menu);
    }
  } finally {
    restoreVideoMenuOrigins();
    restoreMenuOverlayFrameworkOrigins(previousMenuOrigins);
    runtime.menu.vid.viddef.width = previousWidth;
    runtime.menu.vid.viddef.height = previousHeight;
    runtime.menu.qmenu.state.vidWidth = previousWidth;
    runtime.menu.qmenu.state.vidHeight = previousHeight;
    runtime.attachMenuRendererRef(runtime.frontendRenderer?.ref ?? null);
    runtime.drawCommands.length = 0;
  }
}

/**
 * Original name: N/A
 * Source: N/A (web renderer adapter)
 * Category: New
 * Purpose: Lazily create or replace the map-scoped Three/ref_gl game renderer.
 */
function ensureWebAppRenderer(
  runtime: WebAppRuntime,
  page: WebAppPage,
  mapPath: string
): WebAppRendererState | null {
  if (runtime.gameRenderer?.mapPath === mapPath) {
    return runtime.gameRenderer;
  }

  if (runtime.gameRenderer) {
    disposeWebAppRenderer(runtime.gameRenderer);
    runtime.gameRenderer = null;
  }

  if (runtime.gameRendererPromise && runtime.gameRendererPromiseMapPath === mapPath) {
    return null;
  }

  if (runtime.gameRendererPromise && runtime.gameRendererPromiseMapPath !== mapPath) {
    runtime.gameRendererPromise = null;
    runtime.gameRendererPromiseMapPath = null;
  }

  if (!runtime.gameRendererPromise) {
    const expectedMapPath = mapPath;
    runtime.gameRendererPromiseMapPath = expectedMapPath;
    runtime.gameRendererPromise = createWebAppThreeRenderer(runtime, page, expectedMapPath)
      .then((renderer) => {
        if (runtime.gameRendererPromiseMapPath !== expectedMapPath) {
          disposeWebAppRenderer(renderer);
          return renderer;
        }

        runtime.gameRenderer = renderer;
        runtime.gameRendererPromise = null;
        runtime.gameRendererPromiseMapPath = null;
        renderer.renderLoop.resize();
        return renderer;
      })
      .catch((error) => {
        if (runtime.gameRendererPromiseMapPath === expectedMapPath) {
          runtime.gameRendererPromise = null;
          runtime.gameRendererPromiseMapPath = null;
        }
        const message = error instanceof Error ? error.message : `${error}`;
        Con_Print(runtime.console.con, `renderer Three indisponible: ${message}\n`, runtime.client.cls.realtime);
        Con_SyncConsoleToKeys(runtime.console);
        throw error;
      });
  }

  return null;
}

/**
 * Original name: N/A
 * Source: N/A (web renderer adapter)
 * Category: New
 * Purpose: Dispose the browser-owned Three/ref_gl game renderer resources.
 */
function disposeWebAppRenderer(renderer: WebAppRendererState): void {
  renderer.renderLoop.dispose();
  renderer.renderer.domElement.remove();
  renderer.renderer.dispose();
}

async function ensureWebAppFrontendRenderer(
  runtime: WebAppRuntime,
  page: WebAppPage
): Promise<WebAppFrontendRendererState> {
  if (runtime.frontendRenderer) {
    return runtime.frontendRenderer;
  }

  if (runtime.frontendRendererPromise) {
    return runtime.frontendRendererPromise;
  }

  runtime.frontendRendererPromise = createWebAppFrontendRenderer(runtime, page)
    .then((renderer) => {
      runtime.frontendRenderer = renderer;
      runtime.frontendRendererPromise = null;
      runtime.attachMenuRendererRef(renderer.ref);
      resizeWebAppFrontendRenderer(page, renderer);
      warmWebAppFrontendPics(renderer.ref);
      return renderer;
    })
    .catch((error) => {
      runtime.frontendRendererPromise = null;
      const message = error instanceof Error ? error.message : `${error}`;
      Con_Print(runtime.console.con, `renderer frontend Three indisponible: ${message}\n`, runtime.client.cls.realtime);
      Con_SyncConsoleToKeys(runtime.console);
      throw error;
    });

  return runtime.frontendRendererPromise;
}

function warmWebAppFrontendPics(ref: refexport_t): void {
  warmWebAppMenuPics(ref);
}

function warmWebAppMenuPics(ref: refexport_t): void {
  for (const pic of [
    "loading",
    "m_main_game",
    "m_main_game_sel",
    "m_main_multiplayer",
    "m_main_multiplayer_sel",
    "m_main_options",
    "m_main_options_sel",
    "m_main_video",
    "m_main_video_sel",
    "m_main_quit",
    "m_main_quit_sel",
    "m_main_plaque",
    "m_main_logo"
  ]) {
    ref.RegisterPic(pic);
  }

  for (let index = 0; index < NUM_CURSOR_FRAMES; index += 1) {
    ref.RegisterPic(`m_cursor${index}`);
  }

  // Small menu pics share the original scrap atlas; draw once so the atlas is uploaded before the menu is visible.
  ref.DrawPic(0, 0, "m_main_logo");
}

async function createWebAppFrontendRenderer(
  runtime: WebAppRuntime,
  page: WebAppPage
): Promise<WebAppFrontendRendererState> {
  page.frontendViewport.replaceChildren();
  const rendererBundle = await createRenderer();
  rendererBundle.renderer.setClearColor(0x000000, 1);
  const rendererCanvas = rendererBundle.renderer.domElement;
  rendererCanvas.style.position = "absolute";
  rendererCanvas.style.left = "50%";
  rendererCanvas.style.top = "50%";
  rendererCanvas.style.transform = "translate(-50%, -50%)";
  rendererCanvas.style.width = `${LOGICAL_WIDTH}px`;
  rendererCanvas.style.height = `${LOGICAL_HEIGHT}px`;
  rendererCanvas.style.display = "block";
  rendererCanvas.style.imageRendering = "auto";
  page.frontendViewport.append(rendererCanvas);

  const glDrawAdapter = createThreeGlDrawAdapter();
  const imageRuntime = createGlImageRuntime({
    loadFile: (path) => readMountedFile(runtime.filesystem, path)?.bytes ?? null,
    ...glDrawAdapter.imageHooks
  });
  const refGlHost = createRefGlHost({
    createQglProvider: () => createObjectQglProvider(createNoopQglBindings()),
    imageRuntime,
    drawHooks: glDrawAdapter.drawHooks,
    hooks: {
      glimpInit: () => true,
      glimpShutdown: () => undefined,
      glimpSetMode: () => ({
        err: 0,
        width: page.frontendViewport.clientWidth || window.innerWidth || LOGICAL_WIDTH,
        height: page.frontendViewport.clientHeight || window.innerHeight || LOGICAL_HEIGHT
      }),
      glimpBeginFrame: () => undefined,
      glimpEndFrame: () => undefined
    },
    imports: createWebAppRefImports((message) => {
      if (shouldSuppressWebAppConsoleLine(message)) {
        return;
      }

      Con_Print(runtime.console.con, `${message}\n`, runtime.client.cls.realtime);
      Con_SyncConsoleToKeys(runtime.console);
    })
  });
  refGlHost.init();

  return {
    renderer: rendererBundle.renderer,
    rendererLabel: rendererBundle.label,
    glDrawAdapter,
    refGlHost,
    ref: refGlHost.api
  };
}

function resizeWebAppFrontendRenderer(page: WebAppPage, renderer: WebAppFrontendRendererState): void {
  const size = getContainedLogicalViewportSize(page.frontendViewport);
  renderer.renderer.setSize(size.width, size.height, false);
  renderer.renderer.domElement.style.width = `${size.width}px`;
  renderer.renderer.domElement.style.height = `${size.height}px`;
  renderer.glDrawAdapter.setViewport(LOGICAL_WIDTH, LOGICAL_HEIGHT);
}

function getContainedLogicalViewportSize(viewport: HTMLElement): { width: number; height: number } {
  const bounds = viewport.getBoundingClientRect();
  const availableWidth = Math.max(1, Math.round(bounds.width || viewport.clientWidth || window.innerWidth || LOGICAL_WIDTH));
  const availableHeight = Math.max(1, Math.round(bounds.height || viewport.clientHeight || window.innerHeight || LOGICAL_HEIGHT));
  const scale = Math.max(1, Math.floor(Math.min(availableWidth / LOGICAL_WIDTH, availableHeight / LOGICAL_HEIGHT)));

  return {
    width: LOGICAL_WIDTH * scale,
    height: LOGICAL_HEIGHT * scale
  };
}

function disposeWebAppFrontendRenderer(runtime: WebAppRuntime): void {
  const renderer = runtime.frontendRenderer;
  if (!renderer) {
    return;
  }

  renderer.glDrawAdapter.dispose();
  renderer.refGlHost.shutdown();
  renderer.renderer.domElement.remove();
  renderer.renderer.dispose();
  runtime.attachMenuRendererRef(null);
  runtime.frontendRenderer = null;
}

/**
 * Original name: N/A
 * Source: N/A (web renderer adapter)
 * Category: New
 * Purpose: Assemble the map renderer, ref_gl host, scene adapters, and render loop for active gameplay.
 */
async function createWebAppThreeRenderer(
  runtime: WebAppRuntime,
  page: WebAppPage,
  mapPath: string
): Promise<WebAppRendererState> {
  page.gameViewport.replaceChildren();
  const rendererBundle = await createRenderer();
  const rendererCanvas = rendererBundle.renderer.domElement;
  rendererCanvas.style.position = "absolute";
  rendererCanvas.style.inset = "0";
  rendererCanvas.style.width = "100%";
  rendererCanvas.style.height = "100%";
  rendererCanvas.style.display = "block";
  rendererCanvas.style.imageRendering = "auto";
  page.gameViewport.append(rendererCanvas);

  const glWorldAdapter = createThreeGlWorldSceneAdapter(runtime.filesystem, mapPath);
  const skyAdapter = createThreeSkySceneAdapter(createQuakeSkyResolver(runtime.filesystem));
  const glDrawAdapter = createThreeGlDrawAdapter();
  const imageRuntime = createGlImageRuntime({
    loadFile: (path) => readMountedFile(runtime.filesystem, path)?.bytes ?? null,
    ...glDrawAdapter.imageHooks
  });
  const refGlHost = createRefGlHost({
    createQglProvider: () => createObjectQglProvider(createNoopQglBindings()),
    imageRuntime,
    drawHooks: glDrawAdapter.drawHooks,
    hooks: {
      glimpInit: () => true,
      glimpShutdown: () => undefined,
      glimpSetMode: () => ({ err: 0, width: page.gameViewport.clientWidth || LOGICAL_WIDTH, height: page.gameViewport.clientHeight || LOGICAL_HEIGHT }),
      glimpBeginFrame: () => undefined,
      glimpEndFrame: () => undefined
    },
    imports: createWebAppRefImports((message) => {
      if (shouldSuppressWebAppConsoleLine(message)) {
        return;
      }

      Con_Print(runtime.console.con, `${message}\n`, runtime.client.cls.realtime);
      Con_SyncConsoleToKeys(runtime.console);
    })
  });
  refGlHost.init();

  const scene = new Scene();
  scene.add(glWorldAdapter.root);
  scene.add(skyAdapter.root);
  const refreshEntitySync = createThreeRefreshEntitySync(runtime.filesystem);
  refreshEntitySync.setAliasLightSampler(glWorldAdapter.sampleLightPoint);
  const particleSync = createThreeParticleSync(runtime.filesystem);
  const beamSync = createThreeBeamSync(runtime.filesystem);
  const dlightSync = createThreeDlightSync();
  const polyblendOverlay = createThreePolyblendOverlay();
  scene.add(refreshEntitySync.root);
  scene.add(particleSync.root);
  scene.add(beamSync.root);
  scene.add(dlightSync.root);
  refreshEntitySync.setShadowReceiverRoot(glWorldAdapter.root);
  const camera = createCamera();
  scene.add(camera);
  refreshEntitySync.attachToCamera(camera);
  const refreshDebug = createRefreshDebugLayer();
  scene.add(refreshDebug.root);

  const renderLoop = createWebAppRenderLoop({
    renderer: rendererBundle.renderer,
    ui: {
      viewport: page.gameViewport
    },
    scene,
    camera,
    glDrawAdapter,
    polyblendOverlay,
    ref: refGlHost.api,
    skyAdapter,
    glWorldAdapter,
    refreshEntitySync,
    particleSync,
    beamSync,
    dlightSync,
    refreshDebug,
    filesystem: runtime.filesystem,
    audio: runtime.audio,
    hudBindings: buildWebAppHudBindings(runtime.client, runtime.menu.keys.state.keybindings),
    enableRenderSourceAudio: false
  });

  return {
    mapPath,
    renderer: rendererBundle.renderer,
    rendererLabel: rendererBundle.label,
    renderLoop,
    camera,
    ref: refGlHost.api,
    menuOverlayPicsWarmed: false,
    consoleCanvas: document.createElement("canvas")
  };
}

/**
 * Original name: N/A
 * Source: N/A (web adapter for client/cl_inv.c binding lookup)
 * Category: Adapter
 * Purpose: Resolve Quake II `use <item>` key bindings for the inventory HUD.
 *
 * Constraints:
 * - Must preserve the original case-insensitive scan of the first 256 key bindings.
 * - Must not replace the client inventory renderer; it only supplies the C hotkey column input.
 */
function buildWebAppHudBindings(client: ClientRuntime, keybindings: Array<string | null>): Record<string, string> {
  const bindings: Record<string, string> = {};

  for (let item = 0; item < MAX_ITEMS; item += 1) {
    const itemName = client.cl.configstrings[CS_ITEMS + item] ?? "";
    if (itemName.length === 0) {
      continue;
    }

    const target = `use ${itemName}`.toLowerCase();
    for (let key = 0; key < 256 && key < keybindings.length; key += 1) {
      const binding = keybindings[key];
      if (binding && binding.toLowerCase() === target) {
        bindings[itemName] = Key_KeynumToString(key);
        break;
      }
    }
  }

  return bindings;
}

/**
 * Original name: N/A
 * Source: N/A (web renderer adapter)
 * Category: New
 * Purpose: Copy the ported refresh frame camera into the Three camera used by the web renderer.
 */
function syncThreeCameraToRefresh(camera: ReturnType<typeof createCamera>, refreshFrame: ClientRefreshFrame | null): void {
  if (!refreshFrame) {
    return;
  }

  const view = refreshFrame.view;
  camera.position.set(view.vieworg[0], view.vieworg[1], view.vieworg[2]);
  const vectors = AngleVectors(view.viewangles);
  camera.up.set(vectors.up[0], vectors.up[1], vectors.up[2]);
  camera.lookAt(
    view.vieworg[0] + vectors.forward[0],
    view.vieworg[1] + vectors.forward[1],
    view.vieworg[2] + vectors.forward[2]
  );
}

/**
 * Original name: N/A
 * Source: N/A (web renderer adapter)
 * Category: New
 * Purpose: Resolve the authoritative server map path used to scope the active Three renderer.
 */
function getAuthoritativeMapPath(runtime: WebAppRuntime): string | null {
  return getWebAppServerMapPath(runtime.client, runtime.serverHost.currentMapRequest);
}

/**
 * Original name: N/A
 * Source: N/A (web console adapter)
 * Category: Adapter
 * Purpose: Bridge the ported console fraction/snapshot producers to the active web renderer.
 */
function drawConsoleFrame(runtime: WebAppRuntime, page: WebAppPage): void {
  const frac = SCR_RunConsole(runtime.client, {
    keyDest: "console"
  });
  const renderer = runtime.gameRenderer;
  if (renderer) {
    const width = Math.max(1, page.gameViewport.clientWidth || window.innerWidth || LOGICAL_WIDTH);
    const height = Math.max(1, page.gameViewport.clientHeight || window.innerHeight || LOGICAL_HEIGHT);
    const snapshot = Con_DrawConsole(runtime.console, frac, width, height);
    if (snapshot) {
      drawConsoleSnapshotToCanvas(runtime, page, renderer.consoleCanvas, snapshot);
      renderer.renderLoop.renderCanvasOverlay(renderer.consoleCanvas);
      runtime.consoleRenderedInThree = true;
    }
    return;
  }

  const snapshot = Con_DrawConsole(runtime.console, frac, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  if (!snapshot) {
    return;
  }

  drawConsoleSnapshotCanvas(runtime, page, snapshot);
}

/**
 * Original name: N/A
 * Source: N/A (web console adapter)
 * Category: Adapter
 * Purpose: Build a transparent console canvas overlay for the Three renderer compositor.
 */
function prepareConsoleCanvasOverlay(
  runtime: WebAppRuntime,
  page: WebAppPage,
  renderer: WebAppRendererState
): HTMLCanvasElement | null {
  const frac = SCR_RunConsole(runtime.client, {
    keyDest: "console"
  });
  const width = Math.max(1, page.gameViewport.clientWidth || window.innerWidth || LOGICAL_WIDTH);
  const height = Math.max(1, page.gameViewport.clientHeight || window.innerHeight || LOGICAL_HEIGHT);
  const snapshot = Con_DrawConsole(runtime.console, frac, width, height);
  if (!snapshot) {
    return null;
  }

  drawConsoleSnapshotToCanvas(runtime, page, renderer.consoleCanvas, snapshot);
  return renderer.consoleCanvas;
}

/**
 * Original name: N/A
 * Source: N/A (web console canvas helper)
 * Category: New
 * Purpose: Resize and clear the reusable browser canvas before drawing a console snapshot.
 */
function drawConsoleSnapshotToCanvas(
  runtime: WebAppRuntime,
  page: WebAppPage,
  canvas: HTMLCanvasElement,
  snapshot: ConsoleDrawConsoleSnapshot
): void {
  const width = Math.max(1, Math.trunc(snapshot.background.width));
  const height = Math.max(1, Math.trunc(snapshot.background.height));
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  context.clearRect(0, 0, width, height);
  const overlayPage: WebAppPage = { ...page, context };
  drawConsoleSnapshotCanvas(runtime, overlayPage, snapshot);
}

/**
 * Original name: N/A
 * Source: N/A (web console adapter)
 * Category: Adapter
 * Purpose: Render the structured `Con_DrawConsole` snapshot through browser canvas primitives.
 */
function drawConsoleSnapshotCanvas(
  runtime: WebAppRuntime,
  page: WebAppPage,
  snapshot: ConsoleDrawConsoleSnapshot
): void {
  drawOpaqueConsoleBackground(page, snapshot);

  const background = loadPictureCanvas(runtime.filesystem, runtime.assets, snapshot.background.pic);
  if (background) {
    page.context.drawImage(
      background,
      snapshot.background.x,
      snapshot.background.y,
      snapshot.background.width,
      snapshot.background.height
    );
  } else {
    page.context.fillStyle = "rgb(0, 0, 0)";
    page.context.fillRect(0, 0, snapshot.background.width, snapshot.lines);
  }

  for (const line of snapshot.rows) {
    drawConsoleText(page, runtime, line);
  }
  if (snapshot.backscroll) {
    drawConsoleText(page, runtime, snapshot.backscroll);
  }
  if (snapshot.downloadBar) {
    drawConsoleText(page, runtime, snapshot.downloadBar);
  }
  if (snapshot.input) {
    drawConsoleText(page, runtime, snapshot.input);
  }
  drawConsoleText(page, runtime, snapshot.version);
}

/**
 * Original name: N/A
 * Source: N/A (web console canvas helper)
 * Category: New
 * Purpose: Preserve Quake II's opaque `conback` console area when compositing the browser canvas overlay.
 *
 * Constraints:
 * - Must only cover the visible console fraction; the rest of the overlay canvas stays transparent.
 */
function drawOpaqueConsoleBackground(page: WebAppPage, snapshot: ConsoleDrawConsoleSnapshot): void {
  page.context.globalAlpha = 1;
  page.context.globalCompositeOperation = "source-over";
  page.context.fillStyle = "rgb(0, 0, 0)";
  page.context.fillRect(0, 0, snapshot.background.width, snapshot.lines);
}

/**
 * Original name: N/A
 * Source: N/A (web ref console adapter)
 * Category: Adapter
 * Purpose: Bridge the structured console snapshot to a `refexport_t` implementation.
 */
function drawConsoleFrameRef(
  runtime: WebAppRuntime,
  ref: refexport_t,
  viewportWidth: number,
  viewportHeight: number
): void {
  const frac = SCR_RunConsole(runtime.client, {
    keyDest: "console"
  });
  const snapshot = Con_DrawConsole(runtime.console, frac, viewportWidth, viewportHeight);
  if (!snapshot) {
    return;
  }

  ref.DrawStretchPic(
    snapshot.background.x,
    snapshot.background.y,
    snapshot.background.width,
    snapshot.background.height,
    snapshot.background.pic
  );

  for (const line of snapshot.rows) {
    drawConsoleTextRef(ref, line);
  }
  if (snapshot.backscroll) {
    drawConsoleTextRef(ref, snapshot.backscroll);
  }
  if (snapshot.downloadBar) {
    drawConsoleTextRef(ref, snapshot.downloadBar);
  }
  if (snapshot.input) {
    drawConsoleTextRef(ref, snapshot.input);
  }
  drawConsoleTextRef(ref, snapshot.version);
}

/**
 * Original name: N/A
 * Source: N/A (web ref console adapter)
 * Category: Adapter
 * Purpose: Convert console text snapshot rows into `DrawChar` calls on a ref export.
 */
function drawConsoleTextRef(ref: refexport_t, command: ConsoleTextCommand): void {
  const highBit = command.variant === "alt" ? 128 : 0;
  for (let index = 0; index < command.text.length; index += 1) {
    ref.DrawChar(command.x + index * 8, command.y, command.text.charCodeAt(index) | highBit);
  }
}

/**
 * Original name: N/A
 * Source: N/A (web console canvas adapter)
 * Category: Adapter
 * Purpose: Draw console text snapshot rows with the Quake glyph atlas on a browser canvas.
 */
function drawConsoleText(page: WebAppPage, runtime: WebAppRuntime, command: ConsoleTextCommand): void {
  if (!loadGlyphCanvas(runtime.filesystem, runtime.assets)) {
    drawConsoleTextFallback(page, command);
    return;
  }

  const highBit = command.variant === "alt" ? 128 : 0;
  for (let index = 0; index < command.text.length; index += 1) {
    drawGlyph(
      page,
      runtime.filesystem,
      runtime.assets,
      command.x + index * 8,
      command.y,
      command.text.charCodeAt(index) | highBit
    );
  }
}

/**
 * Original name: N/A
 * Source: N/A (web console fallback)
 * Category: New
 * Purpose: Keep console text visible when the Quake glyph atlas is not available yet.
 */
function drawConsoleTextFallback(page: WebAppPage, command: ConsoleTextCommand): void {
  const text = command.text
    .replace(/[\u0080-\u00ff]/g, (char) => String.fromCharCode(char.charCodeAt(0) & 0x7f))
    .trimEnd();
  if (!text) {
    return;
  }

  page.context.font = "8px Consolas, monospace";
  page.context.textBaseline = "top";
  page.context.fillStyle = command.variant === "alt" ? "#f0d060" : "#d8d2c7";
  page.context.fillText(text, command.x, command.y);
}

/**
 * Original name: N/A
 * Source: N/A (web captured draw adapter)
 * Category: Adapter
 * Purpose: Replay renderer-neutral draw commands captured from the ported client/menu code on canvas.
 */
function drawCapturedCommands(page: WebAppPage, runtime: WebAppRuntime): void {
  for (const command of runtime.drawCommands) {
    switch (command.type) {
      case "pic": {
        const image = loadPictureCanvas(runtime.filesystem, runtime.assets, command.name);
        if (image) {
          const width = command.width ?? image.width;
          const height = command.height ?? image.height;
          const x = command.x < 0 ? (LOGICAL_WIDTH - width) / 2 : command.x;
          const y = command.y < 0 ? (LOGICAL_HEIGHT - height) / 2 : command.y;
          page.context.drawImage(
            image,
            x,
            y,
            width,
            height
          );
        }
        break;
      }
      case "char":
        drawGlyph(page, runtime.filesystem, runtime.assets, command.x, command.y, command.code);
        break;
      case "fill":
        drawPaletteFill(page, runtime.assets, command.x, command.y, command.width, command.height, command.color);
        break;
      case "raw":
        drawRawIndexedImage(page, runtime.assets, command);
        break;
      case "fade":
        if (runtime.serverHost.hasActiveAttractLoop() && runtime.menu.keys.state.key_dest === keydest_t.key_menu) {
          break;
        }
        page.context.fillStyle = "rgba(0, 0, 0, 0.58)";
        page.context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
        break;
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (web canvas draw helper)
 * Category: New
 * Purpose: Draw a loaded Quake picture centered in the logical web viewport.
 */
function drawCenteredPicture(page: WebAppPage, runtime: WebAppRuntime, name: string): void {
  const image = loadPictureCanvas(runtime.filesystem, runtime.assets, name);
  if (!image) {
    return;
  }

  page.context.drawImage(
    image,
    (LOGICAL_WIDTH - image.width) / 2,
    (LOGICAL_HEIGHT - image.height) / 2,
    image.width,
    image.height
  );
}

/**
 * Original name: N/A
 * Source: N/A (web canvas draw adapter)
 * Category: Adapter
 * Purpose: Convert a captured indexed raw-image draw command into browser RGBA image data.
 */
function drawRawIndexedImage(
  page: WebAppPage,
  assets: CanvasAssetCache,
  command: Extract<DrawCommand, { type: "raw" }>
): void {
  const palette = assets.paletteRgb;
  if (!palette) {
    return;
  }

  const imageData = page.context.createImageData(command.cols, command.rows);
  for (let index = 0; index < command.data.length; index += 1) {
    const paletteIndex = command.data[index] * 3;
    const rgbaIndex = index * 4;
    imageData.data[rgbaIndex] = palette[paletteIndex] ?? 0;
    imageData.data[rgbaIndex + 1] = palette[paletteIndex + 1] ?? 0;
    imageData.data[rgbaIndex + 2] = palette[paletteIndex + 2] ?? 0;
    imageData.data[rgbaIndex + 3] = 255;
  }

  const temp = document.createElement("canvas");
  temp.width = command.cols;
  temp.height = command.rows;
  temp.getContext("2d")?.putImageData(imageData, 0, 0);
  page.context.drawImage(temp, command.x, command.y, command.width, command.height);
}

/**
 * Original name: N/A
 * Source: N/A (web canvas draw adapter)
 * Category: Adapter
 * Purpose: Draw one captured Quake glyph from the browser-side glyph atlas.
 */
function drawGlyph(
  page: WebAppPage,
  filesystem: VirtualFilesystem,
  assets: CanvasAssetCache,
  x: number,
  y: number,
  code: number
): void {
  const glyphs = loadGlyphCanvas(filesystem, assets);
  if (!glyphs) {
    return;
  }

  const glyphCode = code & 0xff;
  const sx = (glyphCode & 15) * 8;
  const sy = ((glyphCode >> 4) & 15) * 8;
  page.context.drawImage(glyphs, sx, sy, 8, 8, x, y, 8, 8);
}

/**
 * Original name: N/A
 * Source: N/A (web canvas draw adapter)
 * Category: Adapter
 * Purpose: Fill a captured draw rectangle with the active Quake palette color on canvas.
 */
function drawPaletteFill(
  page: WebAppPage,
  assets: CanvasAssetCache,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number
): void {
  const palette = assets.paletteRgb;
  const index = Math.max(0, Math.min(255, Math.trunc(color))) * 3;
  const red = palette?.[index] ?? color;
  const green = palette?.[index + 1] ?? color;
  const blue = palette?.[index + 2] ?? color;
  page.context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
  page.context.fillRect(x, y, width, height);
}

/**
 * Original name: N/A
 * Source: N/A (web canvas asset adapter)
 * Category: Adapter
 * Purpose: Resolve and decode one Quake pic asset into a cached canvas for the web fallback renderer.
 */
function loadPictureCanvas(
  filesystem: VirtualFilesystem,
  assets: CanvasAssetCache,
  name: string
): HTMLCanvasElement | null {
  if (assets.pictures.has(name)) {
    return assets.pictures.get(name) ?? null;
  }

  const file = resolvePictureFile(filesystem, name);
  if (!file) {
    assets.pictures.set(name, null);
    return null;
  }

  try {
    const image = parsePcx(file.bytes, file.path);
    const canvas = pcxToCanvas(image);
    assets.pictures.set(name, canvas);
    if (!assets.paletteRgb) {
      assets.paletteRgb = image.paletteRgb;
    }
    return canvas;
  } catch {
    assets.pictures.set(name, null);
    return null;
  }
}

/**
 * Original name: N/A
 * Source: N/A (web canvas asset adapter)
 * Category: Adapter
 * Purpose: Decode the Quake console glyph sheet into a cached canvas for DOM-backed text drawing.
 */
function loadGlyphCanvas(filesystem: VirtualFilesystem, assets: CanvasAssetCache): HTMLCanvasElement | null {
  if (assets.glyphs) {
    return assets.glyphs;
  }

  const file = readMountedFile(filesystem, "pics/conchars.pcx");
  if (!file) {
    return null;
  }

  const image = parsePcx(file.bytes, file.path);
  assets.paletteRgb = image.paletteRgb;
  assets.glyphs = pcxToCanvas(image);
  return assets.glyphs;
}

/**
 * Original name: N/A
 * Source: N/A (web canvas asset adapter)
 * Category: Adapter
 * Purpose: Apply Quake pic path fallback rules against the mounted browser filesystem.
 */
function resolvePictureFile(filesystem: VirtualFilesystem, name: string): ReturnType<typeof readMountedFile> {
  const normalized = name.replaceAll("\\", "/").replace(/^\/+/, "");
  const candidates = normalized.endsWith(".pcx")
    ? [normalized]
    : normalized.includes("/")
      ? [`${normalized}.pcx`, normalized]
      : [`pics/${normalized}.pcx`, `pics/${normalized}`];

  for (const candidate of candidates) {
    const file = readMountedFile(filesystem, candidate);
    if (file) {
      return file;
    }
  }

  return undefined;
}

/**
 * Original name: N/A
 * Source: N/A (local canvas helper)
 * Category: New
 * Purpose: Materialize a decoded PCX RGBA buffer as a browser canvas.
 */
function pcxToCanvas(image: PcxImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (context) {
    context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
  }
  return canvas;
}

/**
 * Original name: N/A
 * Source: N/A (web input adapter)
 * Category: Adapter
 * Purpose: Route DOM keydown events into the ported client, menu, console and cinematic input paths.
 */
function handleKeyDown(event: KeyboardEvent, runtime: WebAppRuntime, page: WebAppPage): void {
  if (isConsoleToggleDomKey(event)) {
    event.preventDefault();
    void runtime.audio.unlock();
    toggleWebAppConsole(runtime, page);
    return;
  }

  if (isTextInputTarget(event.target)) {
    return;
  }

  const key = mapWebAppDomKey(event);
  if (key === null) {
    return;
  }

  event.preventDefault();
  void runtime.audio.unlock();
  if (key === K_F10) {
    toggleWebAppConsole(runtime, page);
    return;
  }

  if (runtime.mode === "cinematic") {
    if (runtime.serverHost.hasActiveServerMedia()) {
      if (runtime.serverHost.hasActiveAttractLoop()) {
        SCR_StopCinematic(runtime.client, {
          onCinematicSoundRestart: () => {
            runtime.audio.stopRaw();
          }
        });
        SCR_FinishCinematic(runtime.client);
        runtime.audio.stopRaw();
        runtime.mode = "loading";
        clearWebAppLoadingPlaque(runtime.client);
        return;
      }

      const elapsed = runtime.client.cls.realtime - runtime.cinematicStartedAt;
      if (elapsed > 1000 || key === K_ESCAPE || key === K_ENTER || key === K_SPACE) {
        SCR_FinishCinematic(runtime.client);
      }
      return;
    }

    const elapsed = runtime.client.cls.realtime - runtime.cinematicStartedAt;
    if (elapsed > 1000 || key === K_ESCAPE || key === K_ENTER || key === K_SPACE) {
      SCR_StopCinematic(runtime.client);
      runtime.audio.stopRaw();
      runtime.currentCinematicIndex += 1;
      startNextCinematic(runtime, page);
    }
    return;
  }

  if (key === K_ESCAPE && isWebAppAutomaticLevelLoad(runtime)) {
    runtime.mouse.suppressNextEscapeKeyUp = true;
    return;
  }

  if (runtime.mode === "game" && runtime.menu.keys.state.key_dest === keydest_t.key_game) {
    Key_Event(runtime.menu.keys, key, true, runtime.client.cls.realtime);
    executeRuntimeCommandBuffer(runtime, page);
    syncWebAppKeyDestination(runtime, page);
    return;
  }

  if (runtime.menu.keys.state.key_dest === keydest_t.key_console) {
    Key_Event(runtime.menu.keys, key, true, runtime.client.cls.realtime);
    Key_Event(runtime.menu.keys, key, false, runtime.client.cls.realtime);
    executeRuntimeCommandBuffer(runtime, page);
    syncWebAppKeyDestination(runtime, page);
    page.status.textContent = runtime.menu.keys.state.key_dest === keydest_t.key_console
      ? "Console Quake II."
      : "Menu principal Quake II.";
    return;
  }

  M_Keydown(runtime.menu, key);
  executeRuntimeCommandBuffer(runtime, page);
  syncWebAppKeyDestination(runtime, page);
  if (key === K_ESCAPE) {
    runtime.mouse.suppressNextEscapeKeyUp = true;
  }

  const keyDestAfterMenu = runtime.menu.keys.state.key_dest as keydest_t;
  if (keyDestAfterMenu === keydest_t.key_console) {
    runtime.menu.keys.state.console_open = true;
    page.status.textContent = "Console Quake II.";
    return;
  }

  if (keyDestAfterMenu === keydest_t.key_game
    && runtime.client.cls.state === connstate_t.ca_disconnected
    && runtime.gameBridge.phase === "idle") {
    enterMainMenu(runtime, page);
  }
}

/**
 * Original name: N/A
 * Source: N/A (web input adapter)
 * Category: Adapter
 * Purpose: Mirror the ported key destination into the web-app browser mode and status UI.
 */
// A client that joins over the network reaches ca_active without anything
// closing the menu: the engine forces it off only from menu actions and local
// map loads, so a joining player ends up in the game with the menu still
// holding input. Fires once on the transition, so a menu opened deliberately
// mid-game is left alone.
let wasClientActive = false;

function syncWebAppKeyDestination(runtime: WebAppRuntime, page: WebAppPage): void {
  const clientActive = runtime.client.cls.state === connstate_t.ca_active;
  if (clientActive
    && !wasClientActive
    && (runtime.menu.keys.state.key_dest as keydest_t) === keydest_t.key_menu) {
    M_ForceMenuOff(runtime.menu);
  }
  wasClientActive = clientActive;

  const keyDest = runtime.menu.keys.state.key_dest as keydest_t;

  if (keyDest === keydest_t.key_menu && runtime.mode === "game") {
    if (isWebAppAutomaticLevelLoad(runtime)) {
      return;
    }

    releaseWebAppMouseLook(runtime, page);
    runtime.mode = "menu";
    page.status.textContent = "Menu principal Quake II.";
    page.status.style.display = "none";
    return;
  }

  if (keyDest === keydest_t.key_game
    && runtime.mode === "menu"
    && (runtime.client.cls.state === connstate_t.ca_active || runtime.serverHost.hasActiveGameMap())) {
    runtime.mode = "game";
    page.status.textContent = "";
    page.status.style.display = "none";
  }
}

/**
 * Original name: N/A
 * Source: N/A (web console adapter)
 * Category: Adapter
 * Purpose: Toggle the ported console from the assembled web-app runtime.
 */
function toggleWebAppConsole(runtime: WebAppRuntime, page: WebAppPage): void {
  toggleWebAppConsoleContext(runtime.menu, runtime.console, page, runtime.client);
}

function routeWebAppMenuKey(runtime: WebAppRuntime, page: WebAppPage, key: number): void {
  if (runtime.menu.keys.state.key_dest !== keydest_t.key_menu) {
    return;
  }

  M_Keydown(runtime.menu, key);
  executeRuntimeCommandBuffer(runtime, page);
  syncWebAppKeyDestination(runtime, page);
  if (key === K_ESCAPE) {
    runtime.mouse.suppressNextEscapeKeyUp = true;
  }
}

/**
 * Original name: N/A
 * Source: N/A (web console adapter)
 * Category: Adapter
 * Purpose: Invoke the ported console toggle and reflect the resulting key destination in the browser status UI.
 */
function toggleWebAppConsoleContext(
  menu: ClientMenuContext,
  consoleContext: ClientConsoleContext,
  page: WebAppPage,
  client: ClientRuntime
): void {
  const keys = menu.keys.state;
  Con_ToggleConsole_f(consoleContext);
  Con_SyncConsoleToKeys(consoleContext);
  page.status.textContent = keys.key_dest === keydest_t.key_console
    ? "Console Quake II."
    : client.cls.state !== connstate_t.ca_active
      ? "Menu principal Quake II."
      : "";
}

/**
 * Original name: N/A
 * Source: N/A (web input helper)
 * Category: New
 * Purpose: Recognize browser keyboard variants used for the Quake console toggle.
 */
function isConsoleToggleDomKey(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }

  return event.code === "Backquote"
    || event.key === "`"
    || event.key === "~"
    || event.key.charCodeAt(0) === 178
    || event.key === "²";
}

/**
 * Original name: N/A
 * Source: N/A (web input adapter)
 * Category: Adapter
 * Purpose: Route DOM keyup events into the ported key system while preserving browser-only pointer-lock escape handling.
 */
function handleKeyUp(event: KeyboardEvent, runtime: WebAppRuntime, page: WebAppPage): void {
  if (isTextInputTarget(event.target)) {
    return;
  }

  if (isConsoleToggleDomKey(event)) {
    event.preventDefault();
    return;
  }

  const key = mapWebAppDomKey(event);
  if (key === null) {
    return;
  }

  if (key === K_F10) {
    event.preventDefault();
    return;
  }

  if (key === K_ESCAPE && runtime.mouse.suppressNextEscapeKeyUp) {
    runtime.mouse.suppressNextEscapeKeyUp = false;
    event.preventDefault();
    return;
  }

  if (key === K_ESCAPE
    && shouldRoutePointerUnlockAsEscape(runtime)
    && !isWebAppPointerLocked(page)) {
    event.preventDefault();
    routeWebAppEscapeToClient(runtime, page);
    return;
  }

  if (runtime.mode !== "game" || runtime.menu.keys.state.key_dest !== keydest_t.key_game) {
    return;
  }

  event.preventDefault();
  Key_Event(runtime.menu.keys, key, false, runtime.client.cls.realtime);
  executeRuntimeCommandBuffer(runtime, page);
}

/**
 * Original name: N/A
 * Source: N/A (web pointer-lock adapter)
 * Category: Adapter
 * Purpose: Start browser mouse-look capture for active gameplay without replacing the ported key/input runtime.
 */
function handlePointerDown(event: PointerEvent, runtime: WebAppRuntime, page: WebAppPage): void {
  if (isExtendedTouchControlTarget(event.target)) {
    return;
  }

  void runtime.audio.unlock();
  if (runtime.mode !== "game" || runtime.menu.keys.state.key_dest !== keydest_t.key_game) {
    return;
  }

  runtime.mouse.lookActive = true;
  runtime.mouse.dragging = event.buttons !== 0;
  requestWebAppPointerLock(runtime, page, event.target);
}

/**
 * Original name: N/A
 * Source: N/A (web pointer-lock adapter)
 * Category: Adapter
 * Purpose: Mirror browser pointer-lock state and route intentional unlocks back through the ported Escape key path.
 */
function handlePointerLockChange(runtime: WebAppRuntime, page: WebAppPage): void {
  const shouldRouteEscape = runtime.mouse.pointerLockEscapeArmed
    && shouldRoutePointerUnlockAsEscape(runtime);

  runtime.mouse.pointerLocked = isWebAppPointerLocked(page);
  if (runtime.mouse.pointerLocked) {
    runtime.mouse.lookActive = true;
    runtime.mouse.pointerLockEscapeArmed = runtime.mode === "game"
      && runtime.menu.keys.state.key_dest === keydest_t.key_game;
    return;
  }

  runtime.mouse.pointerLockEscapeArmed = false;
  if (shouldRouteEscape) {
    routeWebAppEscapeToClient(runtime, page);
  }
}

/**
 * Original name: N/A
 * Source: N/A (web input adapter)
 * Category: Adapter
 * Purpose: Synthesize the gameplay Escape transition through the ported `Key_Event` dispatcher.
 */
function routeWebAppEscapeToClient(runtime: WebAppRuntime, page: WebAppPage): void {
  runtime.mouse.lookActive = false;
  runtime.mouse.dragging = false;
  Key_Event(runtime.menu.keys, K_ESCAPE, true, runtime.client.cls.realtime);
  executeRuntimeCommandBuffer(runtime, page);
  syncWebAppKeyDestination(runtime, page);
}

function shouldRoutePointerUnlockAsEscape(runtime: WebAppRuntime): boolean {
  return runtime.mode === "game"
    && runtime.menu.keys.state.key_dest === keydest_t.key_game
    && runtime.client.cls.state === connstate_t.ca_active
    && runtime.client.cl.refresh_prepped
    && !runtime.isAuthoritativeLevelLoading()
    && runtime.client.cl.screen.scr_draw_loading === 0;
}

function isWebAppAutomaticLevelLoad(runtime: WebAppRuntime): boolean {
  return runtime.isAuthoritativeLevelLoading()
    || runtime.client.cl.screen.scr_draw_loading !== 0
    || (runtime.client.cls.state !== connstate_t.ca_active && runtime.serverHost.hasActiveGameMap());
}

/**
 * Original name: N/A
 * Source: N/A (web input adapter)
 * Category: Adapter
 * Purpose: Convert browser mouse button transitions to Quake key events for active gameplay bindings.
 */
function handleMouseButton(event: MouseEvent, down: boolean, runtime: WebAppRuntime, page: WebAppPage): void {
  if (isExtendedTouchControlTarget(event.target)) {
    return;
  }

  if (runtime.mode !== "game" || runtime.menu.keys.state.key_dest !== keydest_t.key_game) {
    return;
  }

  const key = mapMouseButton(event);
  if (key === null) {
    return;
  }

  event.preventDefault();
  void runtime.audio.unlock();
  runtime.mouse.lookActive = true;
  runtime.mouse.dragging = down || event.buttons !== 0;
  if (down) {
    requestWebAppPointerLock(runtime, page);
  }
  Key_Event(runtime.menu.keys, key, down, runtime.client.cls.realtime);
  executeRuntimeCommandBuffer(runtime, page);
}

/**
 * Original name: N/A
 * Source: N/A (web input adapter)
 * Category: Adapter
 * Purpose: Convert browser wheel movement to the original Quake mouse-wheel key press/release pair.
 */
function handleMouseWheel(event: WheelEvent, runtime: WebAppRuntime, page: WebAppPage): void {
  if (runtime.mode !== "game" || runtime.menu.keys.state.key_dest !== keydest_t.key_game || event.deltaY === 0) {
    return;
  }

  const key = event.deltaY < 0 ? K_MWHEELUP : K_MWHEELDOWN;
  event.preventDefault();
  Key_Event(runtime.menu.keys, key, true, runtime.client.cls.realtime);
  Key_Event(runtime.menu.keys, key, false, runtime.client.cls.realtime);
  executeRuntimeCommandBuffer(runtime, page);
}

/**
 * Original name: N/A
 * Source: N/A (web input helper)
 * Category: New
 * Purpose: Map DOM mouse button numbers to the Quake key constants owned by `keys.ts`.
 */
function mapMouseButton(event: MouseEvent): number | null {
  switch (event.button) {
    case 0: return K_MOUSE1;
    case 1: return K_MOUSE3;
    case 2: return K_MOUSE2;
    default: return null;
  }
}

/**
 * Original name: N/A
 * Source: N/A (web input helper)
 * Category: New
 * Purpose: Keep browser text controls from being consumed by the web-app key dispatcher.
 */
function isTextInputTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}

function isExtendedTouchControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".q2ext-touch") !== null;
}

/**
 * Original name: N/A
 * Source: N/A (web canvas helper)
 * Category: New
 * Purpose: Keep the browser fallback canvas on the fixed Quake II logical viewport.
 */
function resizeCanvas(page: WebAppPage): void {
  page.canvas.width = LOGICAL_WIDTH;
  page.canvas.height = LOGICAL_HEIGHT;
  page.context.imageSmoothingEnabled = false;
}

/**
 * Original name: N/A
 * Source: N/A (web viewport adapter)
 * Category: New
 * Purpose: Select the visible browser viewport layer for game, frontend, loading and canvas fallback frames.
 */
function syncWebAppViewportVisibility(runtime: WebAppRuntime, page: WebAppPage): void {
  const attractLoopMenuOverlay = shouldDrawAttractLoopMenuOverlay(runtime);
  const loadingOverlayVisible = runtime.mode === "loading"
    || runtime.isAuthoritativeLevelLoading()
    || runtime.client.cl.screen.scr_draw_loading !== 0;
  const gameVisible = runtime.mode === "game" || runtime.isAuthoritativeLevelLoading() || attractLoopMenuOverlay;
  const overlayVisible = !gameVisible || runtime.gameRenderer === null || loadingOverlayVisible;
  const menuRenderedInFrontend = runtime.frontendRenderer !== null
    && runtime.menu.keys.state.key_dest === keydest_t.key_menu
    && runtime.mode === "menu"
    && !attractLoopMenuOverlay;
  const loadingRenderedInFrontend = runtime.frontendRenderer !== null
    && loadingOverlayVisible
    && runtime.menu.keys.state.key_dest !== keydest_t.key_console;
  page.gameViewport.style.display = gameVisible ? "block" : "none";
  page.frontendViewport.style.display = menuRenderedInFrontend || loadingRenderedInFrontend ? "block" : "none";
  page.canvas.style.display = overlayVisible && !menuRenderedInFrontend && !loadingRenderedInFrontend ? "block" : "none";
  page.canvas.style.background = attractLoopMenuOverlay ? "transparent" : "#000";
  page.canvas.style.objectFit = "contain";
  if (attractLoopMenuOverlay) {
    const width = Math.min(window.innerWidth, window.innerHeight * LOGICAL_WIDTH / LOGICAL_HEIGHT, 960);
    const height = width * LOGICAL_HEIGHT / LOGICAL_WIDTH;
    page.canvas.style.width = `${width}px`;
    page.canvas.style.height = `${height}px`;
  } else {
    page.canvas.style.width = "100vw";
    page.canvas.style.height = "100vh";
  }
}

/**
 * Original name: N/A
 * Source: N/A (web canvas helper)
 * Category: New
 * Purpose: Clear the logical fallback canvas before replaying the ported screen draw commands.
 */
function clearCanvas(page: WebAppPage): void {
  page.context.imageSmoothingEnabled = false;
  page.context.fillStyle = "#000";
  page.context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
}

function clearOverlayCanvas(page: WebAppPage): void {
  page.context.imageSmoothingEnabled = false;
  page.context.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
}

/**
 * Original name: N/A
 * Source: N/A (web pointer-lock helper)
 * Category: New
 * Purpose: Reset browser-only mouse-look bookkeeping without changing the ported input state.
 */
function resetWebAppMouseLook(runtime: WebAppRuntime): void {
  runtime.mouse.pointerLocked = false;
  runtime.mouse.pointerLockEscapeArmed = false;
  runtime.mouse.lookActive = false;
  runtime.mouse.dragging = false;
}

/**
 * Original name: N/A
 * Source: N/A (web pointer-lock adapter)
 * Category: Adapter
 * Purpose: Leave browser mouse-look capture when gameplay focus moves back to menu, console or page focus.
 */
function releaseWebAppMouseLook(runtime: WebAppRuntime, page: WebAppPage): void {
  const wasLocked = isWebAppPointerLocked(page);
  resetWebAppMouseLook(runtime);
  if (wasLocked) {
    document.exitPointerLock();
  }
}

/**
 * Original name: N/A
 * Source: N/A (web pointer-lock adapter)
 * Category: Adapter
 * Purpose: Request browser pointer lock only while the ported runtime is accepting gameplay input.
 */
function requestWebAppPointerLock(runtime: WebAppRuntime, page: WebAppPage, eventTarget?: EventTarget | null): void {
  if (runtime.mode !== "game" || runtime.menu.keys.state.key_dest !== keydest_t.key_game) {
    return;
  }

  if (document.pointerLockElement !== null) {
    runtime.mouse.pointerLocked = isWebAppPointerLocked(page);
    return;
  }

  const target = eventTarget instanceof HTMLElement && page.gameViewport.contains(eventTarget)
    ? eventTarget
    : page.gameViewport;
  try {
    void Promise.resolve(target.requestPointerLock()).catch(() => {
      runtime.mouse.pointerLocked = false;
    });
  } catch {
    runtime.mouse.pointerLocked = false;
  }
}

/**
 * Original name: N/A
 * Source: N/A (web mouse-look adapter)
 * Category: Adapter
 * Purpose: Convert browser mouse movement into Quake view-angle updates during active gameplay capture.
 */
function handleMouseMove(event: MouseEvent, runtime: WebAppRuntime, page: WebAppPage): void {
  if (
    runtime.mode !== "game"
    || runtime.menu.keys.state.key_dest !== keydest_t.key_game
  ) {
    return;
  }

  const pointerLocked = isWebAppPointerLocked(page);
  runtime.mouse.pointerLocked = pointerLocked;
  if (!pointerLocked && !isWebAppMouseLookActive(runtime, page, event)) {
    return;
  }

  event.preventDefault();
  applyWebAppMouseLook(runtime, event.movementX, event.movementY);
}

/**
 * Original name: N/A
 * Source: N/A (web pointer-lock helper)
 * Category: New
 * Purpose: Recognize whether the browser lock is held by the web-app viewport.
 */
function isWebAppPointerLocked(page: WebAppPage): boolean {
  const locked = document.pointerLockElement;
  return locked !== null && page.gameViewport.contains(locked);
}

/**
 * Original name: N/A
 * Source: N/A (web mouse-look helper)
 * Category: New
 * Purpose: Keep drag-based browser mouse-look active only while the pointer remains inside the game viewport.
 */
function isWebAppMouseLookActive(runtime: WebAppRuntime, page: WebAppPage, event: MouseEvent): boolean {
  if (!runtime.mouse.lookActive) {
    return false;
  }

  if (runtime.mouse.dragging) {
    return true;
  }

  const bounds = page.gameViewport.getBoundingClientRect();
  return (
    event.clientX >= bounds.left
    && event.clientX <= bounds.right
    && event.clientY >= bounds.top
    && event.clientY <= bounds.bottom
  );
}

/**
 * Original name: N/A
 * Source: N/A (web mouse-look adapter)
 * Category: Adapter
 * Purpose: Apply browser movement deltas through the ported mouse cvars to the client view angles.
 */
function applyWebAppMouseLook(runtime: WebAppRuntime, movementX: number, movementY: number): void {
  const sensitivity = Cvar_VariableValue(runtime.menu.cvar, "sensitivity") || 3;
  const yaw = Cvar_VariableValue(runtime.menu.cvar, "m_yaw") || 0.022;
  const pitch = Cvar_VariableValue(runtime.menu.cvar, "m_pitch") || 0.022;
  runtime.client.cl.viewangles[1] -= movementX * yaw * sensitivity;
  runtime.client.cl.viewangles[0] += movementY * pitch * sensitivity;
  runtime.client.cl.viewangles[0] = Math.max(-89, Math.min(89, runtime.client.cl.viewangles[0]));
}

/**
 * Original name: N/A
 * Source: N/A (web ref_gl adapter)
 * Category: New
 * Purpose: Provide inert QGL procedures so the ported `ref_gl` host can run under Three.js in the browser.
 */
function createNoopQglBindings(): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  for (const name of QGL_REQUIRED_PROCEDURES) {
    bindings[name] = () => undefined;
  }
  bindings.qglGetString = (name: number) => {
    switch (name) {
      case 0x1f00: return "Quake2JS";
      case 0x1f01: return "Three.js";
      case 0x1f02: return "1.0";
      case 0x1f03: return "";
      default: return "";
    }
  };
  bindings.qglGetError = () => 0;
  return bindings;
}

/**
 * Original name: N/A
 * Source: N/A (web ref imports adapter)
 * Category: Adapter
 * Purpose: Build the browser-side `refimport_t` services consumed by the ported `ref_gl` host.
 *
 * Porting notes:
 * - Cvar operations delegate to qcommon's cvar runtime; this helper does not own C/H renderer behavior.
 */
function createWebAppRefImports(onPrint: (message: string) => void): Partial<refimport_t> {
  const cvarRuntime = createCvarRuntime();
  const cvars = new Map<string, cvar_t>();

  return {
    Con_Printf: (level, message) => {
      if (level === PRINT_ALL && message.trim().length > 0) {
        onPrint(message.trim());
      }
    },
    Sys_Error: (_level, message): never => {
      throw new Error(message);
    },
    Cvar_Get: (name, value, flags) => {
      const existing = cvars.get(name);
      if (existing) {
        return existing;
      }
      const created = requireWebAppRefCvar(Cvar_Get(cvarRuntime, name, value, flags), name);
      cvars.set(name, created);
      return created;
    },
    Cvar_Set: (name, value) => {
      const target = requireWebAppRefCvar(QcommonCvar_Set(cvarRuntime, name, value), name);
      cvars.set(name, target);
      return target;
    },
    Cvar_SetValue: (name, value) => {
      const target = requireWebAppRefCvar(QcommonCvar_SetValue(cvarRuntime, name, value), name);
      cvars.set(name, target);
    },
    Cmd_AddCommand: () => undefined,
    Cmd_RemoveCommand: () => undefined,
    FS_Gamedir: () => "baseq2",
    Vid_MenuInit: () => undefined
  };
}

/**
 * Original name: N/A
 * Source: N/A (web ref imports helper)
 * Category: New
 * Purpose: Fail fast if a browser-local ref cvar cannot be created by the qcommon cvar runtime.
 */
function requireWebAppRefCvar(cvar: cvar_t | null, name: string): cvar_t {
  if (!cvar) {
    throw new Error(`Unable to create ref cvar ${name}`);
  }
  return cvar;
}

/**
 * Original name: N/A
 * Source: N/A (web log helper)
 * Category: New
 * Purpose: Keep early browser bootstrap messages visible before the ported console is ready.
 */
function appendLog(page: WebAppPage, line: string): void {
  const next = `${page.log.textContent ?? ""}${line}\n`;
  page.log.textContent = next.split("\n").slice(-8).join("\n");
}
