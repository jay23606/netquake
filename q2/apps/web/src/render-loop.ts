/**
 * File: render-loop.ts
 * Purpose: Render one active Quake II client frame through the shared Three/ref_gl browser path.
 *
 * This file is not a direct source port.
 * It is the web renderer adapter used by the final web-app host.
 *
 * Dependencies:
 * - packages/client
 * - packages/filesystem
 * - packages/platform
 * - packages/renderer-three
 * - three
 */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  type PerspectiveCamera,
} from "three";
import {
  SCR_DrawHudRef,
  type BrushModelSnapshot,
  type ClientRefreshFrame,
  type ClientRuntime,
  type ClientScreenHudState,
  type QuakeSkySnapshot,
  type refexport_t
} from "../../../packages/client/src/index.js";
import type { VirtualFilesystem } from "../../../packages/filesystem/src/index.js";
import type { GameSoundEvent } from "../../../packages/game/src/index.js";
import type { QuakeWebAudioAdapter, WebAudioNamedLoop } from "../../../packages/platform/src/index.js";
import {
  type RefreshEntitySyncStats,
  createThreeBeamSync,
  createThreeDlightSync,
  createThreeGlDrawAdapter,
  createThreeGlWorldSceneAdapter,
  createThreeParticleSync,
  createThreePolyblendOverlay,
  createThreeRefreshEntitySync,
  createThreeSkySceneAdapter
} from "../../../packages/renderer-three/src/index.js";
import type { createRefreshDebugLayer } from "./refresh-debug-layer.js";
import { formatSkySnapshot, type ActiveRenderer } from "./web-render-bootstrap.js";

/**
 * Original name: N/A
 * Source: N/A (web renderer adapter)
 * Category: New
 * Purpose: Describe the client-frame data consumed by the shared browser render loop.
 *
 * Constraints:
 * - Must expose already-ported client/runtime outputs instead of replacing their logic.
 */
export interface WebAppRenderSource {
  runtime: ClientRuntime;
  refreshFrame: ClientRefreshFrame | null;
  screenState: ClientScreenHudState;
  skySnapshot: QuakeSkySnapshot | null;
  getBrushModelSnapshots: () => BrushModelSnapshot[];
  getCvarValue: (name: string) => number;
  resolveSoundPath: (soundIndex: number) => string | null;
  drainLocalGameplaySounds?: () => GameSoundEvent[];
}

/**
 * Original name: N/A
 * Source: N/A (web renderer adapter)
 * Category: New
 * Purpose: Describe the minimal browser UI callbacks used by the shared render loop.
 *
 * Constraints:
 * - Must remain an adapter contract and avoid owning Quake II runtime behavior.
 */
export interface WebAppRenderUi {
  viewport: HTMLElement;
  setSkyText?: (value: string) => void;
  setRuntimeInfo?: (
    value: ClientRefreshFrame | null,
    refreshStats: RefreshEntitySyncStats | null,
    renderedParticleCount?: number
  ) => void;
}

/**
 * Original name: N/A
 * Source: N/A (web renderer adapter)
 * Category: New
 * Purpose: Expose the browser render-loop operations used by the web-app host.
 *
 * Constraints:
 * - Must keep rendering orchestration in apps/web while delegating game/client behavior to packages.
 */
export interface WebAppRenderLoop {
  resize: () => void;
  renderFrame: (options: {
    source: WebAppRenderSource;
    elapsedSeconds: number;
    canvasOverlay?: HTMLCanvasElement;
    drawOverlay?: (api: {
      ref: refexport_t;
      viewportWidth: number;
      viewportHeight: number;
    }) => void;
  }) => void;
  renderOverlay: (draw: (api: {
    ref: refexport_t;
    viewportWidth: number;
    viewportHeight: number;
  }) => void) => void;
  renderCanvasOverlay: (canvas: HTMLCanvasElement) => void;
  dispose: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (web renderer adapter)
 * Category: New
 * Purpose: Collect the renderer, ref_gl adapters and runtime services needed to build the shared render loop.
 *
 * Constraints:
 * - Must compose package-owned adapters without presenting this apps/web file as their source port.
 */
export interface WebAppRenderLoopOptions {
  renderer: ActiveRenderer;
  ui: WebAppRenderUi;
  scene: Scene;
  camera: PerspectiveCamera;
  glDrawAdapter: ReturnType<typeof createThreeGlDrawAdapter>;
  polyblendOverlay: ReturnType<typeof createThreePolyblendOverlay>;
  ref: refexport_t;
  skyAdapter: ReturnType<typeof createThreeSkySceneAdapter>;
  glWorldAdapter: ReturnType<typeof createThreeGlWorldSceneAdapter>;
  refreshEntitySync: ReturnType<typeof createThreeRefreshEntitySync>;
  particleSync: ReturnType<typeof createThreeParticleSync>;
  beamSync: ReturnType<typeof createThreeBeamSync>;
  dlightSync: ReturnType<typeof createThreeDlightSync>;
  refreshDebug: ReturnType<typeof createRefreshDebugLayer>;
  filesystem: VirtualFilesystem;
  audio: QuakeWebAudioAdapter;
  hudBindings?: Record<string, string>;
  enableRenderSourceAudio?: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (web renderer adapter)
 * Category: New
 * Purpose: Compose the browser Three/ref_gl frame loop from package-owned renderer and runtime adapters.
 *
 * Constraints:
 * - Must orchestrate the active frame without replacing client, server or ref_gl ownership.
 */
export function createWebAppRenderLoop(options: WebAppRenderLoopOptions): WebAppRenderLoop {
  const {
    renderer,
    ui,
    scene,
    camera,
    glDrawAdapter,
    polyblendOverlay,
    ref,
    skyAdapter,
    glWorldAdapter,
    refreshEntitySync,
    particleSync,
    beamSync,
    dlightSync,
    refreshDebug,
    filesystem,
    audio,
    hudBindings = {},
    enableRenderSourceAudio = true
  } = options;
  const canvasOverlay = createCanvasOverlay();

  const resize = (): void => {
    const { width, height } = getRenderableViewportSize(ui.viewport);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    glDrawAdapter.setViewport(width, height);
    polyblendOverlay.setViewport(width, height);
  };

  const renderFrame: WebAppRenderLoop["renderFrame"] = ({ source, elapsedSeconds, canvasOverlay: frameCanvasOverlay, drawOverlay }) => {
    updateAudioListener(audio, camera);
    if (enableRenderSourceAudio) {
      flushLocalGameplaySounds(source, filesystem, audio, camera);
      syncLocalLoopSounds(source, filesystem, audio, camera);
    }

    const textureLighting = {
      intensity: resolveTextureIntensity(source),
      gamma: resolveTextureGamma(source)
    };
    glWorldAdapter.setTextureLighting(textureLighting);
    refreshEntitySync.setTextureLighting(textureLighting);
    glWorldAdapter.update(elapsedSeconds, [
      camera.position.x,
      camera.position.y,
      camera.position.z
    ], source.getBrushModelSnapshots(), source.refreshFrame);
    skyAdapter.update(source.skySnapshot, camera, elapsedSeconds, glWorldAdapter.skyFaces);
    ui.setSkyText?.(formatSkySnapshot(source.skySnapshot));
    refreshEntitySync.setAliasShadowsEnabled(source.getCvarValue("gl_shadows") !== 0);
    const refreshEntityStats = refreshEntitySync.apply(source.runtime, source.refreshFrame);
    const renderedParticleCount = particleSync.apply(source.refreshFrame);
    beamSync.apply(source.refreshFrame);
    dlightSync.apply(source.refreshFrame);
    refreshDebug.update(source.refreshFrame);
    polyblendOverlay.applyFrame(
      source.refreshFrame,
      source.getCvarValue("gl_polyblend") !== 0
    );
    ui.setRuntimeInfo?.(source.refreshFrame, refreshEntityStats, renderedParticleCount);

    glDrawAdapter.clear();
    const viewportSize = getRenderableViewportSize(ui.viewport);
    SCR_DrawHudRef(
      source.runtime,
      ref,
      {
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
        active: true,
        refreshPrepped: true
      },
      {
        screenState: source.screenState,
        crosshairValue: source.getCvarValue("crosshair"),
        bindings: hudBindings
      }
    );
    drawOverlay?.({
      ref,
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height
    });

    renderer.autoClear = false;
    renderer.clear();
    renderSceneWithoutViewWeapon(renderer, scene, camera, refreshEntitySync.viewWeaponRoot);
    renderViewWeaponDepthHackPass(renderer, scene, camera, refreshEntitySync.viewWeaponRoot);
    renderer.clearDepth();
    renderer.render(polyblendOverlay.scene, polyblendOverlay.camera);
    renderer.render(glDrawAdapter.scene, glDrawAdapter.camera);
    if (frameCanvasOverlay) {
      canvasOverlay.setViewport(viewportSize.width, viewportSize.height);
      canvasOverlay.setCanvas(frameCanvasOverlay);
      renderer.clearDepth();
      renderer.render(canvasOverlay.scene, canvasOverlay.camera);
    }
  };

  const renderOverlay: WebAppRenderLoop["renderOverlay"] = (draw) => {
    const viewportSize = getRenderableViewportSize(ui.viewport);
    glDrawAdapter.setViewport(viewportSize.width, viewportSize.height);
    glDrawAdapter.clear();
    draw({
      ref,
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height
    });
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(glDrawAdapter.scene, glDrawAdapter.camera);
  };

  const renderCanvasOverlay: WebAppRenderLoop["renderCanvasOverlay"] = (canvas) => {
    const viewportSize = getRenderableViewportSize(ui.viewport);
    canvasOverlay.setViewport(viewportSize.width, viewportSize.height);
    canvasOverlay.setCanvas(canvas);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(canvasOverlay.scene, canvasOverlay.camera);
  };

  const dispose = (): void => {
    if (enableRenderSourceAudio) {
      audio.syncWavLoops(filesystem, []);
    }
    glDrawAdapter.dispose();
    polyblendOverlay.dispose();
    refreshEntitySync.dispose();
    beamSync.dispose();
    dlightSync.dispose();
    refreshDebug.update(null);
    canvasOverlay.dispose();
    disposeObjectTree(scene);
  };

  return { resize, renderFrame, renderOverlay, renderCanvasOverlay, dispose };
}

function renderSceneWithoutViewWeapon(
  renderer: ActiveRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  viewWeaponRoot: Object3D
): void {
  const viewWeaponVisible = viewWeaponRoot.visible;
  viewWeaponRoot.visible = false;
  try {
    renderer.render(scene, camera);
  } finally {
    viewWeaponRoot.visible = viewWeaponVisible;
  }
}

function renderViewWeaponDepthHackPass(
  renderer: ActiveRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  viewWeaponRoot: Object3D
): void {
  if (!viewWeaponRoot.visible || viewWeaponRoot.children.length === 0) {
    return;
  }

  const hidden = hideSceneChildrenExceptCamera(scene, camera);
  try {
    renderer.clearDepth();
    renderer.render(scene, camera);
  } finally {
    restoreSceneChildVisibility(hidden);
  }
}

function hideSceneChildrenExceptCamera(
  scene: Scene,
  camera: PerspectiveCamera
): Array<{ object: Object3D; visible: boolean }> {
  const hidden: Array<{ object: Object3D; visible: boolean }> = [];
  for (const child of scene.children) {
    if (child === camera) {
      continue;
    }

    hidden.push({ object: child, visible: child.visible });
    child.visible = false;
  }
  return hidden;
}

function restoreSceneChildVisibility(hidden: Array<{ object: Object3D; visible: boolean }>): void {
  for (const item of hidden) {
    item.object.visible = item.visible;
  }
}

function resolveTextureIntensity(source: WebAppRenderSource): number {
  const value = source.getCvarValue("intensity");
  return Number.isFinite(value) && value > 1 ? value : 2;
}

function resolveTextureGamma(source: WebAppRenderSource): number {
  const value = source.getCvarValue("vid_gamma");
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Original name: N/A
 * Source: N/A (local render-loop helper)
 * Category: New
 * Purpose: Project a 2D canvas overlay into the shared Three render pass.
 *
 * Constraints:
 * - Must stay private to the web render loop and dispose its Three resources.
 */
function createCanvasOverlay(): {
  scene: Scene;
  camera: OrthographicCamera;
  setViewport: (width: number, height: number) => void;
  setCanvas: (canvas: HTMLCanvasElement) => void;
  dispose: () => void;
} {
  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1, 1, 0, -100, 100);
  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "web-app-console-canvas-overlay";
  mesh.renderOrder = 1000;
  scene.add(mesh);
  let texture: CanvasTexture | null = null;

  return {
    scene,
    camera,
    setViewport: (width, height) => {
      const safeWidth = Math.max(1, width);
      const safeHeight = Math.max(1, height);
      camera.left = 0;
      camera.right = safeWidth;
      camera.top = safeHeight;
      camera.bottom = 0;
      camera.position.set(0, 0, 10);
      camera.lookAt(new Vector3(0, 0, 0));
      camera.updateProjectionMatrix();
      mesh.position.set(safeWidth / 2, safeHeight / 2, 0);
      mesh.scale.set(safeWidth, safeHeight, 1);
    },
    setCanvas: (canvas) => {
      if (!texture || texture.image !== canvas) {
        texture?.dispose();
        texture = new CanvasTexture(canvas);
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        material.map = texture;
      }
      texture.needsUpdate = true;
      material.needsUpdate = true;
    },
    dispose: () => {
      texture?.dispose();
      geometry.dispose();
      material.dispose();
    }
  };
}

/**
 * Original name: N/A
 * Source: N/A (local render-loop helper)
 * Category: New
 * Purpose: Derive a safe non-zero render viewport from the browser DOM.
 *
 * Constraints:
 * - Must prevent hidden or empty elements from passing zero dimensions to Three.
 */
function getRenderableViewportSize(viewport: HTMLElement): { width: number; height: number } {
  const rect = viewport.getBoundingClientRect();
  const width = Math.round(rect.width || viewport.clientWidth || window.innerWidth || 640);
  const height = Math.round(rect.height || viewport.clientHeight || window.innerHeight || 480);

  return {
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}

/**
 * Original name: N/A
 * Source: N/A (local render-loop helper)
 * Category: New
 * Purpose: Dispose geometries and materials owned by the render-loop scene tree.
 *
 * Constraints:
 * - Must remain cleanup-only and avoid mutating runtime/client state.
 */
function disposeObjectTree(root: Scene): void {
  root.traverse((object) => {
    const geometry = (object as { geometry?: { dispose?: () => void } }).geometry;
    geometry?.dispose?.();

    const material = (object as { material?: { dispose?: () => void } | Array<{ dispose?: () => void }> }).material;
    if (Array.isArray(material)) {
      for (const entry of material) {
        entry.dispose?.();
      }
      return;
    }

    material?.dispose?.();
  });
}

/**
 * Original name: N/A
 * Source: N/A (web audio adapter helper)
 * Category: New
 * Purpose: Mirror the active Three camera orientation into the browser audio listener.
 *
 * Constraints:
 * - Must adapt renderer camera state only; gameplay audio ownership stays in client/audio packages.
 */
function updateAudioListener(audio: QuakeWebAudioAdapter, camera: PerspectiveCamera): void {
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  audio.setListener({
    position: [camera.position.x, camera.position.y, camera.position.z],
    forward: [forward.x, forward.y, forward.z],
    up: [up.x, up.y, up.z]
  });
}

/**
 * Original name: N/A
 * Source: N/A (web audio adapter helper)
 * Category: New
 * Purpose: Drain optional local gameplay one-shot WAV events for non-authoritative render sources.
 *
 * Constraints:
 * - Must remain disabled by `enableRenderSourceAudio: false` in authoritative web-app mode.
 */
function flushLocalGameplaySounds(
  source: WebAppRenderSource,
  filesystem: VirtualFilesystem,
  audio: QuakeWebAudioAdapter,
  camera: PerspectiveCamera
): void {
  const drainSounds = source.drainLocalGameplaySounds;
  if (!drainSounds) {
    return;
  }

  for (const event of drainSounds()) {
    const origin = event.origin ?? event.entity?.s.origin ?? null;
    const volume = event.volume ?? 1;
    if (!origin) {
      audio.playWavAt(filesystem, event.soundPath, {
        leftVolume: 255 * volume,
        rightVolume: 255 * volume
      });
      continue;
    }

    const volumes = spatializeLoopSound(camera, origin[0], origin[1], origin[2]);
    audio.playWavAt(filesystem, event.soundPath, {
      leftVolume: volumes.leftVolume * volume,
      rightVolume: volumes.rightVolume * volume
    });
  }
}

/**
 * Original name: N/A
 * Source: N/A (web audio adapter helper)
 * Category: New
 * Purpose: Synchronize optional entity loop WAVs for non-authoritative render sources.
 *
 * Constraints:
 * - Must consume already-produced client frame entities and not replace the authoritative DMA loop path.
 */
function syncLocalLoopSounds(
  source: WebAppRenderSource,
  filesystem: VirtualFilesystem,
  audio: QuakeWebAudioAdapter,
  camera: PerspectiveCamera
): void {
  const frame = source.runtime.cl.frame;
  const parseEntities = source.runtime.cl_parse_entities;
  const loops: WebAudioNamedLoop[] = [];

  for (let index = 0; index < frame.num_entities; index += 1) {
    const parseIndex = (frame.parse_entities + index) & (parseEntities.length - 1);
    const entity = parseEntities[parseIndex];
    if (!entity.sound) {
      continue;
    }

    const soundPath = source.resolveSoundPath(entity.sound);
    if (!soundPath) {
      continue;
    }

    const volumes = spatializeLoopSound(camera, entity.origin[0], entity.origin[1], entity.origin[2]);
    if (volumes.leftVolume === 0 && volumes.rightVolume === 0) {
      continue;
    }

    loops.push({
      key: `entity:${entity.number}:sound:${entity.sound}`,
      name: soundPath,
      leftVolume: volumes.leftVolume,
      rightVolume: volumes.rightVolume
    });
  }

  audio.syncWavLoops(filesystem, loops);
}

/**
 * Original name: N/A
 * Source: N/A (web audio adapter helper)
 * Category: New
 * Purpose: Convert a world-space sound origin into simple stereo WAV volumes for web adapter playback.
 *
 * Constraints:
 * - Must stay a local adapter calculation, not a port-owner for the client sound spatialization code.
 */
function spatializeLoopSound(
  camera: PerspectiveCamera,
  x: number,
  y: number,
  z: number
): { leftVolume: number; rightVolume: number } {
  const source = new Vector3(x, y, z).sub(camera.position);
  let distance = source.length();
  if (distance > 0) {
    source.divideScalar(distance);
  }

  distance -= 80;
  if (distance < 0) {
    distance = 0;
  }
  distance *= 0.003;

  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  const dot = right.dot(source);
  const rightScale = 0.5 * (1 + dot);
  const leftScale = 0.5 * (1 - dot);
  const attenuation = Math.max(0, 1 - distance);

  return {
    leftVolume: Math.trunc(255 * attenuation * leftScale),
    rightVolume: Math.trunc(255 * attenuation * rightScale)
  };
}
