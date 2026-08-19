/**
 * File: cl_view.ts
 * Source: Quake II original / client/cl_view.c
 * Purpose: Port the client-side logical view composition used to build camera-ready values.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Exposes view values as a returned object instead of mutating renderer-facing globals.
 * - Accepts explicit prediction/runtime toggles as arguments while matching original branch behavior.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original C source.
 * - This file is the principal TypeScript attachment point for `client/cl_view.c`.
 * - Prediction collision and movement helpers from `client/cl_pred.c` live in `cl_pred.ts`.
 * - `apps/web` only applies the already computed view state to `PerspectiveCamera`.
 * - Renderer adapters only consume refresh-facing entities and view values built by the client runtime.
 */

import {
  AngleVectors,
  CS_CDTRACK,
  CS_IMAGES,
  CS_MODELS,
  CS_PLAYERSKINS,
  CS_SKY,
  CS_SKYAXIS,
  CS_SKYROTATE,
  LerpAngle,
  MAX_CLIENTS,
  MAX_IMAGES,
  PMF_NO_PREDICTION,
  MAX_LIGHTSTYLES,
  MAX_MODELS,
  CVAR_ARCHIVE,
  Cmd_Argc,
  Cmd_AddCommand,
  Cmd_Argv,
  Cvar_Get,
  pmtype_t,
  vec3_origin,
  type CommandRuntime,
  type CvarRuntime,
  type cvar_t,
  type cmodel_t,
  type trace_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import { type ClientRuntime, connstate_t } from "./client.js";
import { RF_USE_DISGUISE, UPDATE_MASK } from "../../qcommon/src/index.js";
import { MAX_CLIENTWEAPONMODELS } from "./client.js";
import {
  MAX_DLIGHTS,
  MAX_ENTITIES,
  MAX_PARTICLES,
  createRefDef,
  createDlight,
  createEntity,
  createLightstyle,
  createParticle,
  type image_s,
  type model_s,
  type dlight_t,
  type entity_t,
  type refdef_t,
  type refexport_t,
  type lightstyle_t,
  type particle_t
} from "./ref.js";
import { CL_LoadClientinfo, CL_ParseClientinfo, registerClientinfoResources as registerParsedClientinfoResources } from "./cl_parse.js";
import { SCR_AddDirtyPoint, SCR_TouchPics } from "./cl_scrn.js";
import type { vrect_t } from "./cl_scrn.js";
import { Con_ClearNotify, type console_t } from "./console.js";
import { CL_RegisterTEntModels } from "./cl_tent.js";
import type { ClientDynamicLight, ClientRefreshFrame, ClientRenderEntity, ClientRenderParticle } from "./refresh.js";
import type { ClientPredictionCollisionSource } from "./cl_pred.js";

/**
 * Original name: N/A
 * Source: N/A (view value contract)
 * Category: New
 * Purpose: Hold the logical refdef-style values calculated from parsed client frames.
 *
 * Constraints:
 * - Must preserve Quake II view vectors and blend/fov state for later renderer adapters.
 */
export interface ClientViewValues {
  vieworg: vec3_t;
  viewangles: vec3_t;
  forward: vec3_t;
  right: vec3_t;
  up: vec3_t;
  fov_x: number;
  blend: [number, number, number, number];
}

/**
 * Original name: N/A
 * Source: N/A (view options contract)
 * Category: New
 * Purpose: Describe the runtime knobs needed by the current lightweight prediction/view helpers.
 *
 * Constraints:
 * - Defaults should mirror the common Quake II enabled path.
 */
export interface ClientViewOptions {
  predictMovement?: boolean;
  timedemo?: boolean;
  paused?: boolean;
  showmiss?: boolean;
  onPredictionMessage?: (message: string) => void;
  incomingAcknowledged?: number;
  outgoingSequence?: number;
  predictionCollision?: ClientPredictionCollisionSource;
  trace?: (start: vec3_t, mins: vec3_t, maxs: vec3_t, end: vec3_t) => trace_t;
  pointcontents?: (point: vec3_t) => number;
  drawGun?: boolean;
  gunFrameOverride?: number;
  gunModelOverride?: string | null;
}

/**
 * Original name: N/A
 * Source: N/A (scene staging contract)
 * Category: New
 * Purpose: Preserve the temporary renderer-facing scene buffers that `cl_view.c` fills through `V_*`.
 *
 * Constraints:
 * - Must keep explicit counts plus backing arrays, just like the original client-side staging buffers.
 */
export interface ClientViewScene {
  r_numdlights: number;
  r_dlights: dlight_t[];
  r_numentities: number;
  r_entities: entity_t[];
  r_numparticles: number;
  r_particles: particle_t[];
  r_lightstyles: lightstyle_t[];
}

/**
 * Original name: N/A
 * Source: N/A (view debug state)
 * Category: New
 * Purpose: Preserve the tiny gun-debug state owned by `cl_view.c`.
 */
export interface ClientViewDebugState {
  gun_frame: number;
  gun_model: string | null;
}

/**
 * Original name: N/A
 * Source: N/A (view runtime context)
 * Category: New
 * Purpose: Group the command/cvar references owned by `V_Init`.
 */
export interface ClientViewContext {
  client: ClientRuntime;
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  debug: ClientViewDebugState;
  scene: ClientViewScene;
  refdef: refdef_t;
  crosshair: cvar_t | null;
  cl_gun: cvar_t | null;
  cl_testblend: cvar_t | null;
  cl_testparticles: cvar_t | null;
  cl_testentities: cvar_t | null;
  cl_testlights: cvar_t | null;
  cl_stats: cvar_t | null;
}

/**
 * Original name: N/A
 * Source: N/A (crosshair draw contract)
 * Category: New
 * Purpose: Describe one renderer-neutral crosshair draw command rebuilt from `SCR_DrawCrosshair`.
 */
export interface ClientCrosshairDraw {
  x: number;
  y: number;
  pic: string;
}

/**
 * Original name: N/A
 * Source: N/A (rendered view contract)
 * Category: New
 * Purpose: Describe the renderer-neutral output rebuilt by `V_RenderView`.
 */
export interface ClientRenderedView {
  refdef: refdef_t;
  crosshair: ClientCrosshairDraw | null;
  statsLine: string | null;
}

/**
 * Original name: N/A
 * Source: N/A (render view options contract)
 * Category: New
 * Purpose: Describe the host services and toggles needed by the `V_RenderView` port.
 */
export interface ClientRenderViewOptions extends ClientViewOptions {
  stereoSeparation?: number;
  addEntities?: boolean;
  addParticles?: boolean;
  addLights?: boolean;
  addBlend?: boolean;
  currentTimeMs?: number;
  buildRefreshFrame: (runtime: ClientRuntime, options?: ClientViewOptions) => ClientRefreshFrame;
  resolveEntityModel?: (entity: ClientRenderEntity) => entity_t["model"];
  resolveEntitySkin?: (entity: ClientRenderEntity) => entity_t["skin"];
  renderFrame?: (refdef: refdef_t) => void;
}

/**
 * Original name: N/A
 * Source: N/A (prep refresh options contract)
 * Category: New
 * Purpose: Describe the host/runtime services needed by the `CL_PrepRefresh` port.
 *
 * Constraints:
 * - Must keep renderer, console and platform side effects explicit while preserving the original call order.
 */
export interface ClientPrepRefreshOptions {
  ref?: Pick<
    refexport_t,
    "BeginRegistration" | "RegisterModel" | "RegisterSkin" | "RegisterPic" | "SetSky" | "EndRegistration" | "DrawGetPicSize"
  >;
  viewportWidth?: number;
  viewportHeight?: number;
  crosshairValue?: number;
  console?: console_t;
  onPrint?: (line: string) => void;
  onUpdateScreen?: () => void;
  onPumpEvents?: () => void;
  onPlayCdTrack?: (track: number, looping: boolean) => void;
  inlineModel?: (name: string) => cmodel_t | null;
}

/**
 * Original name: N/A
 * Source: N/A (prep refresh result contract)
 * Category: New
 * Purpose: Report the registration work completed by the `CL_PrepRefresh` port.
 *
 * Constraints:
 * - Must expose the original map and asset counts without depending on one renderer backend.
 */
export interface ClientPrepRefreshResult {
  mapname: string;
  modelCount: number;
  imageCount: number;
  clientInfoCount: number;
}

/**
 * Original name: N/A
 * Source: N/A (scene factory)
 * Category: New
 * Purpose: Create zero-initialized `cl_view.c` scene staging buffers.
 */
export function createClientViewScene(): ClientViewScene {
  return {
    r_numdlights: 0,
    r_dlights: Array.from({ length: MAX_DLIGHTS }, () => createDlight()),
    r_numentities: 0,
    r_entities: Array.from({ length: MAX_ENTITIES }, () => createEntity()),
    r_numparticles: 0,
    r_particles: Array.from({ length: MAX_PARTICLES }, () => createParticle()),
    r_lightstyles: Array.from({ length: MAX_LIGHTSTYLES }, () => createLightstyle())
  };
}

/**
 * Original name: N/A
 * Source: N/A (debug state factory)
 * Category: New
 * Purpose: Create zero-initialized gun-debug state matching the globals in `cl_view.c`.
 */
export function createClientViewDebugState(): ClientViewDebugState {
  return {
    gun_frame: 0,
    gun_model: null
  };
}

/**
 * Original name: N/A
 * Source: N/A (view context factory)
 * Category: New
 * Purpose: Create zero-initialized state for the `cl_view.c` init/debug cvars and commands.
 */
export function createClientViewContext(client: ClientRuntime, cmd: CommandRuntime, cvar: CvarRuntime): ClientViewContext {
  return {
    client,
    cmd,
    cvar,
    debug: createClientViewDebugState(),
    scene: createClientViewScene(),
    refdef: createRefDef(),
    crosshair: null,
    cl_gun: null,
    cl_testblend: null,
    cl_testparticles: null,
    cl_testentities: null,
    cl_testlights: null,
    cl_stats: null
  };
}

/**
 * Original name: V_ClearScene
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears the temporary renderer-facing scene counters before a new view build.
 */
export function V_ClearScene(scene: ClientViewScene): void {
  scene.r_numdlights = 0;
  scene.r_numentities = 0;
  scene.r_numparticles = 0;
}

/**
 * Original name: V_AddEntity
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Appends one renderer-facing entity to the current temporary scene if capacity permits.
 */
export function V_AddEntity(scene: ClientViewScene, ent: entity_t): void {
  if (scene.r_numentities >= MAX_ENTITIES) {
    return;
  }

  scene.r_entities[scene.r_numentities] = {
    ...ent,
    angles: [...ent.angles],
    origin: [...ent.origin],
    oldorigin: [...ent.oldorigin]
  };
  scene.r_numentities += 1;
}

/**
 * Original name: V_AddParticle
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Appends one particle to the current temporary scene if capacity permits.
 */
export function V_AddParticle(scene: ClientViewScene, org: vec3_t, color: number, alpha: number): void {
  if (scene.r_numparticles >= MAX_PARTICLES) {
    return;
  }

  const particle = scene.r_particles[scene.r_numparticles];
  particle.origin = [...org];
  particle.color = color;
  particle.alpha = alpha;
  scene.r_numparticles += 1;
}

/**
 * Original name: V_AddLight
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Appends one dynamic light to the current temporary scene if capacity permits.
 */
export function V_AddLight(scene: ClientViewScene, org: vec3_t, intensity: number, r: number, g: number, b: number): void {
  if (scene.r_numdlights >= MAX_DLIGHTS) {
    return;
  }

  const dlight = scene.r_dlights[scene.r_numdlights];
  dlight.origin = [...org];
  dlight.color = [r, g, b];
  dlight.intensity = intensity;
  scene.r_numdlights += 1;
}

/**
 * Original name: V_AddLightStyle
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Updates one staged lightstyle slot for the current scene.
 */
export function V_AddLightStyle(scene: ClientViewScene, style: number, r: number, g: number, b: number): void {
  if (style < 0 || style >= MAX_LIGHTSTYLES) {
    throw new Error(`Bad light style ${style}`);
  }

  const lightstyle = scene.r_lightstyles[style];
  lightstyle.white = r + g + b;
  lightstyle.rgb = [r, g, b];
}

/**
 * Original name: V_TestParticles
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Fills the temporary scene with the original test particle grid projected from the current view.
 */
export function V_TestParticles(scene: ClientViewScene, view: ClientViewValues, alpha: number): void {
  scene.r_numparticles = MAX_PARTICLES;

  for (let index = 0; index < scene.r_numparticles; index += 1) {
    const d = index * 0.25;
    const r = 4 * ((index & 7) - 3.5);
    const u = 4 * (((index >> 3) & 7) - 3.5);
    const particle = scene.r_particles[index];

    for (let component = 0; component < 3; component += 1) {
      particle.origin[component] =
        view.vieworg[component] +
        view.forward[component] * d +
        view.right[component] * r +
        view.up[component] * u;
    }

    particle.color = 8;
    particle.alpha = alpha;
  }
}

/**
 * Original name: V_TestEntities
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fills the temporary scene with the original 32-entity debug model grid.
 */
export function V_TestEntities(scene: ClientViewScene, runtime: ClientRuntime, view: ClientViewValues): void {
  scene.r_numentities = 32;

  for (let index = 0; index < scene.r_numentities; index += 1) {
    const ent = createEntity();
    const r = 64 * ((index % 4) - 1.5);
    const f = 64 * Math.floor(index / 4) + 128;

    for (let component = 0; component < 3; component += 1) {
      ent.origin[component] =
        view.vieworg[component] +
        view.forward[component] * f +
        view.right[component] * r;
    }

    ent.model = runtime.cl.baseclientinfo.model ?? null;
    ent.skin = runtime.cl.baseclientinfo.skin ?? null;
    scene.r_entities[index] = ent;
  }
}

/**
 * Original name: V_TestLights
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Fills the temporary scene with the original 32-light debug grid.
 */
export function V_TestLights(scene: ClientViewScene, view: ClientViewValues): void {
  scene.r_numdlights = 32;

  for (let index = 0; index < scene.r_numdlights; index += 1) {
    const dlight = createDlight();
    const r = 64 * ((index % 4) - 1.5);
    const f = 64 * Math.floor(index / 4) + 128;

    for (let component = 0; component < 3; component += 1) {
      dlight.origin[component] =
        view.vieworg[component] +
        view.forward[component] * f +
        view.right[component] * r;
    }

    dlight.color[0] = (((index % 6) + 1) & 1);
    dlight.color[1] = ((((index % 6) + 1) & 2) >> 1);
    dlight.color[2] = ((((index % 6) + 1) & 4) >> 2);
    dlight.intensity = 200;
    scene.r_dlights[index] = dlight;
  }
}

/**
 * Original name: CalcFov
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts horizontal field-of-view into vertical field-of-view for the current viewport.
 */
export function CalcFov(fov_x: number, width: number, height: number): number {
  if (fov_x < 1 || fov_x > 179) {
    throw new Error(`Bad fov: ${fov_x}`);
  }

  const x = width / Math.tan(fov_x / 360 * Math.PI);
  const a = Math.atan(height / x);
  return a * 360 / Math.PI;
}

/**
 * Original name: V_Gun_Next_f
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances the debug gun frame counter and returns the same status text printed by the C command.
 */
export function V_Gun_Next_f(state: ClientViewDebugState): string {
  state.gun_frame += 1;
  return `frame ${state.gun_frame}`;
}

/**
 * Original name: V_Gun_Prev_f
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Rewinds the debug gun frame counter, clamps it at zero, and returns the original status text.
 */
export function V_Gun_Prev_f(state: ClientViewDebugState): string {
  state.gun_frame -= 1;
  if (state.gun_frame < 0) {
    state.gun_frame = 0;
  }
  return `frame ${state.gun_frame}`;
}

/**
 * Original name: V_Gun_Model_f
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Clears the debug gun model without one argument, otherwise builds the original `models/%s/tris.md2` path.
 *
 * Porting notes:
 * - Stores the model path for renderer-neutral refresh assembly instead of calling `re.RegisterModel` directly.
 */
export function V_Gun_Model_f(state: ClientViewDebugState, modelName: string | null): string | null {
  if (!modelName) {
    state.gun_model = null;
    return state.gun_model;
  }

  state.gun_model = `models/${modelName}/tris.md2`;
  return state.gun_model;
}

/**
 * Original name: V_Viewpos_f
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Formats the current view origin and yaw as the original `viewpos` command output.
 */
export function V_Viewpos_f(view: Pick<ClientViewValues, "vieworg" | "viewangles">): string {
  return `(${Math.trunc(view.vieworg[0])} ${Math.trunc(view.vieworg[1])} ${Math.trunc(view.vieworg[2])}) : ${Math.trunc(view.viewangles[1])}`;
}

/**
 * Original name: SCR_DrawCrosshair
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Rebuilds the centered crosshair draw command from the already prepared screen state.
 */
export function SCR_DrawCrosshair(
  runtime: ClientRuntime,
  viewport: vrect_t,
  crosshair: cvar_t | null,
  options: {
    onTouchPics?: () => void;
  } = {}
): ClientCrosshairDraw | null {
  if (!crosshair || crosshair.value === 0) {
    return null;
  }

  if (crosshair.modified) {
    crosshair.modified = false;
    options.onTouchPics?.();
  }

  if (!runtime.cl.screen.crosshair_pic) {
    return null;
  }

  return {
    x: viewport.x + ((viewport.width - runtime.cl.screen.crosshair_width) >> 1),
    y: viewport.y + ((viewport.height - runtime.cl.screen.crosshair_height) >> 1),
    pic: runtime.cl.screen.crosshair_pic
  };
}

/**
 * Original name: V_Init
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers the `cl_view.c` console commands and cvars needed by the current view/debug paths.
 */
export function V_Init(context: ClientViewContext): void {
  Cmd_AddCommand(context.cmd, "gun_next", () => {
    context.client.output.push(V_Gun_Next_f(context.debug));
  });
  Cmd_AddCommand(context.cmd, "gun_prev", () => {
    context.client.output.push(V_Gun_Prev_f(context.debug));
  });
  Cmd_AddCommand(context.cmd, "gun_model", () => {
    V_Gun_Model_f(context.debug, Cmd_Argc(context.cmd) === 2 ? Cmd_Argv(context.cmd, 1) : null);
  });
  Cmd_AddCommand(context.cmd, "viewpos", () => {
    const view = CL_CalcViewValues(context.client);
    context.client.output.push(V_Viewpos_f(view));
  });

  context.crosshair = Cvar_Get(context.cvar, "crosshair", "0", CVAR_ARCHIVE);
  context.cl_gun = Cvar_Get(context.cvar, "cl_gun", "1", 0);
  context.cl_testblend = Cvar_Get(context.cvar, "cl_testblend", "0", 0);
  context.cl_testparticles = Cvar_Get(context.cvar, "cl_testparticles", "0", 0);
  context.cl_testentities = Cvar_Get(context.cvar, "cl_testentities", "0", 0);
  context.cl_testlights = Cvar_Get(context.cvar, "cl_testlights", "0", 0);
  context.cl_stats = Cvar_Get(context.cvar, "cl_stats", "0", 0);
}

/**
 * Original name: CL_PrepRefresh
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Prepares the client refresh state for a newly loaded level by registering models, pics, player info and sky data.
 *
 * Porting notes:
 * - Keeps renderer/platform effects in explicit hooks while preserving the original registration order.
 * - Stores registered handles back into the client runtime so later view composition can resolve models and skins without adapter callbacks.
 */
export function CL_PrepRefresh(
  runtime: ClientRuntime,
  options: ClientPrepRefreshOptions = {}
): ClientPrepRefreshResult | null {
  const worldModel = runtime.cl.configstrings[CS_MODELS + 1] ?? "";
  if (worldModel.length === 0) {
    return null;
  }

  const viewportWidth = options.viewportWidth ?? runtime.cl.screen.scr_vrect.width;
  const viewportHeight = options.viewportHeight ?? runtime.cl.screen.scr_vrect.height;
  if (viewportWidth > 0 && viewportHeight > 0) {
    SCR_AddDirtyPoint(runtime, 0, 0);
    SCR_AddDirtyPoint(runtime, viewportWidth - 1, viewportHeight - 1);
  }

  const mapname = extractMapName(worldModel);

  options.onPrint?.(`Map: ${mapname}\r`);
  options.onUpdateScreen?.();
  options.ref?.BeginRegistration(mapname);
  options.onPrint?.("                                     \r");

  options.onPrint?.("pics\r");
  options.onUpdateScreen?.();
  const touchPicsOptions: {
    runtime: ClientRuntime;
    getPicSize?: (pic: string) => { width: number; height: number };
  } = {
    runtime,
    ...(options.ref?.DrawGetPicSize ? { getPicSize: options.ref.DrawGetPicSize } : {})
  };
  for (const pic of SCR_TouchPics(options.crosshairValue ?? 0, touchPicsOptions)) {
    options.ref?.RegisterPic(pic);
  }
  options.onPrint?.("                                     \r");

  const tentAssets = CL_RegisterTEntModels(runtime);
  for (const model of tentAssets.models) {
    options.ref?.RegisterModel(model);
  }
  for (const pic of tentAssets.pics) {
    options.ref?.RegisterPic(pic);
  }

  runtime.cl.num_cl_weaponmodels = 1;
  runtime.cl.cl_weaponmodels[0] = "weapon.md2";
  for (let index = 1; index < MAX_CLIENTWEAPONMODELS; index += 1) {
    runtime.cl.cl_weaponmodels[index] = "";
  }

  let modelCount = 0;
  for (let index = 1; index < MAX_MODELS; index += 1) {
    const name = runtime.cl.configstrings[CS_MODELS + index] ?? "";
    if (name.length === 0) {
      break;
    }

    const displayName = name.slice(0, 37);
    if (!name.startsWith("*")) {
      options.onPrint?.(`${displayName}\r`);
    }
    options.onUpdateScreen?.();
    options.onPumpEvents?.();

    if (name.startsWith("#")) {
      if (runtime.cl.num_cl_weaponmodels < MAX_CLIENTWEAPONMODELS) {
        runtime.cl.cl_weaponmodels[runtime.cl.num_cl_weaponmodels] = name.slice(1);
        runtime.cl.num_cl_weaponmodels += 1;
      }
    } else {
      runtime.cl.model_draw[index] = options.ref?.RegisterModel(name) ?? name;
      runtime.cl.model_clip[index] = name.startsWith("*")
        ? (options.inlineModel?.(name) ?? null)
        : null;
    }

    if (!name.startsWith("*")) {
      options.onPrint?.("                                     \r");
    }
    modelCount += 1;
  }

  options.onPrint?.("images\r");
  options.onUpdateScreen?.();
  let imageCount = 0;
  for (let index = 1; index < MAX_IMAGES; index += 1) {
    const name = runtime.cl.configstrings[CS_IMAGES + index] ?? "";
    if (name.length === 0) {
      break;
    }

    runtime.cl.image_precache[index] = options.ref?.RegisterPic(name) ?? name;
    options.onPumpEvents?.();
    imageCount += 1;
  }
  options.onPrint?.("                                     \r");

  let clientInfoCount = 0;
  for (let index = 0; index < MAX_CLIENTS; index += 1) {
    if (!(runtime.cl.configstrings[CS_PLAYERSKINS + index] ?? "").length) {
      continue;
    }

    options.onPrint?.(`client ${index}\r`);
    options.onUpdateScreen?.();
    options.onPumpEvents?.();
    CL_ParseClientinfo(runtime, index);
    registerClientinfoResources(runtime.cl.clientinfo[index], options.ref);
    options.onPrint?.("                                     \r");
    clientInfoCount += 1;
  }

  CL_LoadClientinfo(runtime, runtime.cl.baseclientinfo, "unnamed\\male/grunt");
  registerClientinfoResources(runtime.cl.baseclientinfo, options.ref);

  options.onPrint?.("sky\r");
  options.onUpdateScreen?.();
  runtime.cl.sky.name = runtime.cl.configstrings[CS_SKY] ?? "";
  runtime.cl.sky.rotate = parseSkyRotate(runtime.cl.configstrings[CS_SKYROTATE] ?? "");
  runtime.cl.sky.axis = parseSkyAxis(runtime.cl.configstrings[CS_SKYAXIS] ?? "");
  options.ref?.SetSky(runtime.cl.sky.name, runtime.cl.sky.rotate, runtime.cl.sky.axis);
  options.onPrint?.("                                     \r");

  options.ref?.EndRegistration();
  if (options.console) {
    Con_ClearNotify(options.console);
  }
  options.onUpdateScreen?.();
  runtime.cl.refresh_prepped = true;
  runtime.cl.force_refdef = true;

  const cdTrackText = runtime.cl.configstrings[CS_CDTRACK] ?? "";
  const cdTrack = Number.parseInt(cdTrackText, 10);
  options.onPlayCdTrack?.(Number.isFinite(cdTrack) ? cdTrack : 0, true);

  return {
    mapname,
    modelCount,
    imageCount,
    clientInfoCount
  };
}

/**
 * Original name: V_RenderView
 * Source: client/cl_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Rebuilds the current renderer-neutral `refdef_t` from the active client frame and optional debug toggles.
 */
export function V_RenderView(
  context: ClientViewContext,
  options: ClientRenderViewOptions
): ClientRenderedView | null {
  const runtime = context.client;
  const stereoSeparation = options.stereoSeparation ?? 0;

  if (runtime.cls.state !== connstate_t.ca_active) {
    return null;
  }

  if (!runtime.cl.refresh_prepped) {
    return null;
  }

  if (options.timedemo) {
    if (!runtime.cl.timedemo_start) {
      runtime.cl.timedemo_start = options.currentTimeMs ?? runtime.cls.realtime;
    }
    runtime.cl.timedemo_frames += 1;
  }

  if (runtime.cl.frame.valid && (runtime.cl.force_refdef || !options.paused)) {
    runtime.cl.force_refdef = false;

    const refreshFrame = options.buildRefreshFrame(runtime, {
      ...options,
      drawGun: options.drawGun ?? ((context.cl_gun?.value ?? 1) !== 0),
      gunFrameOverride: options.gunFrameOverride ?? context.debug.gun_frame,
      gunModelOverride: options.gunModelOverride ?? context.debug.gun_model
    });
    fillSceneFromRefreshFrame(context.scene, runtime, refreshFrame, options);

    if ((context.cl_testparticles?.value ?? 0) !== 0) {
      V_TestParticles(context.scene, refreshFrame.view, context.cl_testparticles?.value ?? 0);
    }
    if ((context.cl_testentities?.value ?? 0) !== 0) {
      V_TestEntities(context.scene, runtime, refreshFrame.view);
    }
    if ((context.cl_testlights?.value ?? 0) !== 0) {
      V_TestLights(context.scene, refreshFrame.view);
    }

    context.refdef = buildRefdefFromScene(
      context.scene,
      runtime,
      refreshFrame,
      stereoSeparation,
      options,
      (context.cl_testblend?.value ?? 0) !== 0
    );
  }

  options.renderFrame?.(context.refdef);

  const vrect = runtime.cl.screen.scr_vrect;
  SCR_AddDirtyPoint(runtime, vrect.x, vrect.y);
  SCR_AddDirtyPoint(runtime, vrect.x + vrect.width - 1, vrect.y + vrect.height - 1);

  const crosshair = SCR_DrawCrosshair(runtime, vrect, context.crosshair);
  const statsLine =
    (context.cl_stats?.value ?? 0) !== 0
      ? `ent:${context.refdef.num_entities}  lt:${context.refdef.num_dlights}  part:${context.refdef.num_particles}`
      : null;

  return {
    refdef: context.refdef,
    crosshair,
    statsLine
  };
}

/**
 * Original name: N/A
 * Source: N/A (CL_AddEntities lerp helper)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates `cl.time` clamping and computes the current interpolation fraction.
 *
 * Porting notes:
 * - Extracts the time/lerp portion used before structured entity emission.
 * - Proprietary `CL_AddEntities` ownership lives in `packages/client/src/refresh.ts` as `CL_BuildRefreshFrame`.
 */
export function CL_UpdateLerpFraction(runtime: ClientRuntime, options: ClientViewOptions = {}): number {
  if (runtime.cls.state !== connstate_t.ca_active) {
    runtime.cl.lerpfrac = 1;
    return runtime.cl.lerpfrac;
  }

  if (runtime.cl.time > runtime.cl.frame.servertime) {
    runtime.cl.time = runtime.cl.frame.servertime;
    runtime.cl.lerpfrac = 1;
  } else if (runtime.cl.time < runtime.cl.frame.servertime - 100) {
    runtime.cl.time = runtime.cl.frame.servertime - 100;
    runtime.cl.lerpfrac = 0;
  } else {
    runtime.cl.lerpfrac = 1 - (runtime.cl.frame.servertime - runtime.cl.time) * 0.01;
  }

  if (options.timedemo) {
    runtime.cl.lerpfrac = 1;
  }

  return runtime.cl.lerpfrac;
}

/**
 * Original name: CL_CalcViewValues
 * Source: client/cl_ents.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Computes the interpolated logical camera origin, angles, vectors, fov and blend from current and previous frames.
 *
 * Porting notes:
 * - Returns a value object instead of mutating `cl.refdef`.
 * - Focuses on the already-portable math and prediction branches.
 */
export function CL_CalcViewValues(runtime: ClientRuntime, options: ClientViewOptions = {}): ClientViewValues {
  const ps = runtime.cl.frame.playerstate;
  let oldframe = runtime.cl.frames[(runtime.cl.frame.serverframe - 1) & UPDATE_MASK];
  if (oldframe.serverframe !== runtime.cl.frame.serverframe - 1 || !oldframe.valid) {
    oldframe = runtime.cl.frame;
  }

  let ops = oldframe.playerstate;
  if (
    Math.abs(ops.pmove.origin[0] - ps.pmove.origin[0]) > 256 * 8 ||
    Math.abs(ops.pmove.origin[1] - ps.pmove.origin[1]) > 256 * 8 ||
    Math.abs(ops.pmove.origin[2] - ps.pmove.origin[2]) > 256 * 8
  ) {
    ops = ps;
  }

  const lerp = runtime.cl.lerpfrac;
  const backlerp = 1 - lerp;
  const vieworg: vec3_t = [0, 0, 0];
  const viewangles: vec3_t = [0, 0, 0];

  if (options.predictMovement && (runtime.cl.frame.playerstate.pmove.pm_flags & PMF_NO_PREDICTION) === 0) {
    for (let index = 0; index < 3; index += 1) {
      vieworg[index] =
        runtime.cl.predicted_origin[index] +
        ops.viewoffset[index] +
        runtime.cl.lerpfrac * (ps.viewoffset[index] - ops.viewoffset[index]) -
        backlerp * runtime.cl.prediction_error[index];
    }

    const delta = runtime.cls.realtime - runtime.cl.predicted_step_time;
    if (delta < 100) {
      vieworg[2] -= runtime.cl.predicted_step * (100 - delta) * 0.01;
    }
  } else {
    for (let index = 0; index < 3; index += 1) {
      const oldValue = ops.pmove.origin[index] * 0.125 + ops.viewoffset[index];
      const newValue = ps.pmove.origin[index] * 0.125 + ps.viewoffset[index];
      vieworg[index] = oldValue + lerp * (newValue - oldValue);
    }
  }

  if (runtime.cl.frame.playerstate.pmove.pm_type < pmtype_t.PM_DEAD) {
    for (let index = 0; index < 3; index += 1) {
      viewangles[index] = runtime.cl.predicted_angles[index];
    }
  } else {
    for (let index = 0; index < 3; index += 1) {
      viewangles[index] = LerpAngle(ops.viewangles[index], ps.viewangles[index], lerp);
    }
  }

  for (let index = 0; index < 3; index += 1) {
    viewangles[index] += LerpAngle(ops.kick_angles[index], ps.kick_angles[index], lerp);
  }

  const vectors = AngleVectors(viewangles);
  return {
    vieworg,
    viewangles,
    forward: vectors.forward,
    right: vectors.right,
    up: vectors.up,
    fov_x: ops.fov + lerp * (ps.fov - ops.fov),
    blend: [...ps.blend]
  };
}

/**
 * Original name: N/A
 * Source: N/A (refresh frame adapter)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Adapts the structured `CL_AddEntities` refresh frame into the `cl_view.c` `V_Add*` staging buffers.
 */
function fillSceneFromRefreshFrame(
  scene: ClientViewScene,
  runtime: ClientRuntime,
  refreshFrame: ClientRefreshFrame,
  options: ClientRenderViewOptions
): void {
  scene.r_numentities = 0;
  scene.r_numdlights = 0;
  scene.r_numparticles = 0;

  for (let index = 0; index < MAX_LIGHTSTYLES; index += 1) {
    scene.r_lightstyles[index].rgb = [0, 0, 0];
    scene.r_lightstyles[index].white = 0;
  }

  for (const style of refreshFrame.lightStyles) {
    V_AddLightStyle(scene, style.style, style.rgb[0], style.rgb[1], style.rgb[2]);
  }

  const sortedEntities = [...refreshFrame.entities].sort(compareRenderEntities);
  for (const renderEntity of sortedEntities) {
    V_AddEntity(scene, {
      model: resolveSceneEntityModel(runtime, renderEntity, options.resolveEntityModel),
      angles: [...renderEntity.angles],
      origin: [...renderEntity.origin],
      frame: renderEntity.frame,
      oldorigin: [...renderEntity.oldorigin],
      oldframe: renderEntity.oldframe,
      backlerp: renderEntity.backlerp,
      skinnum: renderEntity.skinnum,
      lightstyle: 0,
      alpha: renderEntity.alpha,
      skin: resolveSceneEntitySkin(runtime, renderEntity, options.resolveEntitySkin),
      flags: renderEntity.flags
    });
  }

  for (const light of refreshFrame.lights) {
    V_AddLight(scene, light.origin, light.intensity, light.color[0], light.color[1], light.color[2]);
  }

  for (const particle of refreshFrame.particles) {
    V_AddParticle(scene, particle.origin, particle.color, particle.alpha);
  }
}

/**
 * Original name: N/A
 * Source: N/A (refdef assembly adapter)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Adapts the staged `cl_view.c` scene buffers into the renderer-facing `refdef_t`.
 */
function buildRefdefFromScene(
  scene: ClientViewScene,
  runtime: ClientRuntime,
  refreshFrame: ClientRefreshFrame,
  stereoSeparation: number,
  options: ClientRenderViewOptions,
  applyTestBlend: boolean
): refdef_t {
  const refdef = createRefDef();
  refdef.vieworg = [...refreshFrame.view.vieworg];
  refdef.viewangles = [...refreshFrame.view.viewangles];
  refdef.blend = [...refreshFrame.view.blend];

  if ((options.addBlend ?? true) === false) {
    refdef.blend = [0, 0, 0, 0];
  } else if (applyTestBlend) {
    refdef.blend = [1, 0.5, 0.25, 0.5];
  }

  if (stereoSeparation !== 0) {
    refdef.vieworg[0] += refreshFrame.view.right[0] * stereoSeparation;
    refdef.vieworg[1] += refreshFrame.view.right[1] * stereoSeparation;
    refdef.vieworg[2] += refreshFrame.view.right[2] * stereoSeparation;
  }

  refdef.vieworg[0] += 1.0 / 16;
  refdef.vieworg[1] += 1.0 / 16;
  refdef.vieworg[2] += 1.0 / 16;

  const vrect = runtime.cl.screen.scr_vrect;
  refdef.x = vrect.x;
  refdef.y = vrect.y;
  refdef.width = vrect.width;
  refdef.height = vrect.height;
  refdef.fov_x = refreshFrame.view.fov_x;
  refdef.fov_y = CalcFov(refdef.fov_x, refdef.width, refdef.height);
  refdef.time = runtime.cl.time * 0.001;
  refdef.areabits = runtime.cl.frame.areabits;
  refdef.rdflags = runtime.cl.frame.playerstate.rdflags;
  refdef.lightstyles = scene.r_lightstyles.map((style) => ({
    rgb: [...style.rgb],
    white: style.white
  }));

  refdef.num_entities = options.addEntities ?? true ? scene.r_numentities : 0;
  refdef.entities = scene.r_entities.slice(0, refdef.num_entities).map((entity) => ({
    ...entity,
    angles: [...entity.angles],
    origin: [...entity.origin],
    oldorigin: [...entity.oldorigin]
  }));

  refdef.num_particles = options.addParticles ?? true ? scene.r_numparticles : 0;
  refdef.particles = scene.r_particles.slice(0, refdef.num_particles).map((particle) => ({
    origin: [...particle.origin],
    color: particle.color,
    alpha: particle.alpha
  }));

  refdef.num_dlights = options.addLights ?? true ? scene.r_numdlights : 0;
  refdef.dlights = scene.r_dlights.slice(0, refdef.num_dlights).map((dlight) => ({
    origin: [...dlight.origin],
    color: [...dlight.color],
    intensity: dlight.intensity
  }));

  return refdef;
}

/**
 * Original name: N/A
 * Source: N/A (local sort helper)
 * Category: New
 * Purpose: Keep refresh entities in a stable model/skinnum order before scene staging.
 */
function compareRenderEntities(a: ClientRenderEntity, b: ClientRenderEntity): number {
  if (a.modelindex === b.modelindex) {
    return a.skinnum - b.skinnum;
  }

  return a.modelindex - b.modelindex;
}

/**
 * Original name: N/A
 * Source: N/A (render entity model adapter)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves structured `CL_AddPacketEntities` model metadata to `entity_t.model` handles for `V_RenderView`.
 */
function resolveSceneEntityModel(
  runtime: ClientRuntime,
  entity: ClientRenderEntity,
  resolveEntityModel?: (entity: ClientRenderEntity) => entity_t["model"]
): model_s | null {
  if (entity.resolvedModelPath) {
    return entity.resolvedModelPath as model_s;
  }

  const resolved = resolveEntityModel?.(entity);
  if (resolved !== undefined) {
    return resolved;
  }

  if (entity.customPlayerSkin || entity.customWeaponModel) {
    const clientInfo = runtime.cl.clientinfo[entity.skinnum & 0xff] ?? runtime.cl.baseclientinfo;
    if (entity.linkedModelSlot === 2) {
      const weaponModelIndex = Math.trunc(entity.skinnum / 256);
      const resolvedWeaponModelIndex =
        weaponModelIndex > 0 && weaponModelIndex < MAX_CLIENTWEAPONMODELS
          ? weaponModelIndex
          : 0;
      return (clientInfo.weaponmodel[resolvedWeaponModelIndex] as model_s | null)
        ?? (clientInfo.weaponmodel[0] as model_s | null)
          ?? (runtime.cl.baseclientinfo.weaponmodel[0] as model_s | null)
          ?? null;
    }

    if ((entity.flags & RF_USE_DISGUISE) !== 0) {
      const disguiseModelPath = getDisguiseModelPath(clientInfo.model_name);
      if (disguiseModelPath) {
        return disguiseModelPath as model_s;
      }
    }

    return (clientInfo.model as model_s | null) ?? (runtime.cl.baseclientinfo.model as model_s | null) ?? null;
  }

  return (runtime.cl.model_draw[entity.modelindex] as model_s | null) ?? null;
}

/**
 * Original name: N/A
 * Source: N/A (render entity skin adapter)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves structured `CL_AddPacketEntities` skin metadata to `entity_t.skin` handles for `V_RenderView`.
 */
function resolveSceneEntitySkin(
  runtime: ClientRuntime,
  entity: ClientRenderEntity,
  resolveEntitySkin?: (entity: ClientRenderEntity) => entity_t["skin"]
): image_s | null {
  const resolved = resolveEntitySkin?.(entity);
  if (resolved !== undefined) {
    return resolved;
  }

  if (entity.customPlayerSkin) {
    const clientInfo = runtime.cl.clientinfo[entity.skinnum & 0xff] ?? runtime.cl.baseclientinfo;
    if ((entity.flags & RF_USE_DISGUISE) !== 0) {
      const disguiseSkinPath = getDisguiseSkinPath(clientInfo.model_name);
      if (disguiseSkinPath) {
        return disguiseSkinPath as image_s;
      }
    }

    return (clientInfo.skin as image_s | null) ?? (runtime.cl.baseclientinfo.skin as image_s | null) ?? null;
  }

  return null;
}

/**
 * Original name: N/A
 * Source: N/A (CL_AddPacketEntities disguise adapter)
 * Category: Adapter
 * Purpose: Recreate the `RF_USE_DISGUISE` player-model remap from `CL_AddPacketEntities`.
 */
function getDisguiseModelPath(modelName: string): string | null {
  switch (modelName) {
    case "male":
      return "players/male/tris.md2";
    case "female":
      return "players/female/tris.md2";
    case "cyborg":
      return "players/cyborg/tris.md2";
    default:
      return null;
  }
}

/**
 * Original name: N/A
 * Source: N/A (CL_AddPacketEntities disguise adapter)
 * Category: Adapter
 * Purpose: Recreate the `RF_USE_DISGUISE` player-skin remap from `CL_AddPacketEntities`.
 */
function getDisguiseSkinPath(modelName: string): string | null {
  switch (modelName) {
    case "male":
      return "players/male/disguise.pcx";
    case "female":
      return "players/female/disguise.pcx";
    case "cyborg":
      return "players/cyborg/disguise.pcx";
    default:
      return null;
  }
}

/**
 * Original name: N/A
 * Source: N/A (clientinfo registration adapter)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Adapts parsed clientinfo resource registration to the renderer hooks used by `CL_PrepRefresh`.
 */
function registerClientinfoResources(
  clientinfo: ClientRuntime["cl"]["clientinfo"][number],
  ref?: Pick<refexport_t, "RegisterModel" | "RegisterSkin" | "RegisterPic">
): void {
  registerParsedClientinfoResources(clientinfo, {
    registerModel: (name) => ref ? ref.RegisterModel(name) : name,
    registerSkin: (name) => ref ? ref.RegisterSkin(name) : name,
    registerPic: (name) => ref ? ref.RegisterPic(name) : name
  });
}

/**
 * Original name: N/A
 * Source: N/A (map name helper)
 * Category: New
 * Purpose: Extract the display map name from the registered world model path.
 */
function extractMapName(worldModel: string): string {
  const mapPath = worldModel.startsWith("maps/") ? worldModel.slice(5) : worldModel;
  return mapPath.endsWith(".bsp") ? mapPath.slice(0, -4) : mapPath;
}

/**
 * Original name: N/A
 * Source: N/A (sky configstring parser)
 * Category: New
 * Purpose: Parse `CS_SKYROTATE` while preserving Quake II's invalid-value fallback.
 */
function parseSkyRotate(value: string): number {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Original name: N/A
 * Source: N/A (sky configstring parser)
 * Category: New
 * Purpose: Parse `CS_SKYAXIS` into a renderer-facing vector.
 */
function parseSkyAxis(value: string): vec3_t {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => Number.parseFloat(part));

  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return [0, 0, 0];
  }

  return [parts[0], parts[1], parts[2]];
}
