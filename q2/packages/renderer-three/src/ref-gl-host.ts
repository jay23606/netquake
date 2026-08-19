/**
 * File: ref-gl-host.ts
 * Purpose: Compose a minimal classic Quake II `ref_gl` host around the ported bootstrap and exported renderer API.
 *
 * This file is not a direct source port.
 * It is an integration helper for host runtimes that want one ready-to-use `refexport_t`.
 *
 * Dependencies:
 * - packages/client/src/ref.ts
 * - packages/renderer-three/src/ref-gl-bootstrap.ts
 * - packages/renderer-three/src/gl_rmain.ts
 * - packages/renderer-three/src/gl_rmisc.ts
 */

import { createRefImport, type refexport_t, type refimport_t } from "../../client/src/ref.js";
import { MAX_QPATH } from "../../qcommon/src/index.js";
import {
  Draw_GetPalette,
  GL_Bind,
  GL_FindImage,
  GL_FreeUnusedImages,
  GL_InitImages,
  GL_LoadPic,
  GL_ShutdownImages,
  GL_TextureAlphaMode,
  GL_TextureMode,
  GL_TextureSolidMode,
  R_RegisterSkin,
  Scrap_Upload,
  imagetype_t,
  setIntensityValue,
  setNoBindEnabled,
  setPaletteExtensionState,
  setPicmipValue,
  setProtectedImages,
  setRendererFlags as setImageRendererFlags,
  setRoundDownEnabled,
  setVidGammaValue,
  type GlImageRuntime
} from "./gl_image.js";
import { GetRefAPI, setRmainParticleTexture, type GlRmainRefApiHooks } from "./gl_rmain.js";
import { setWarpTurbulenceScale, type GlWarpRuntime } from "./gl_warp.js";
import {
  GL_ScreenShot_f,
  GL_SetDefaultState,
  GL_Strings_f,
  GL_UpdateSwapInterval,
  R_InitParticleTexture,
  createGlRmiscRuntime,
  setRmiscCvars,
  setRmiscGlConfig,
  setRmiscGlState,
  setRmiscImageRuntime,
  setRmiscVid,
  syncRmiscExtensionStateFromRmain,
  type GlRmiscHooks,
  type GlRmiscRuntime
} from "./gl_rmisc.js";
import {
  Draw_Char,
  Draw_FadeScreen,
  Draw_Fill,
  Draw_GetPicSize,
  Draw_InitLocal,
  Draw_Pic,
  Draw_StretchPic,
  Draw_StretchRaw,
  Draw_TileClear,
  createGlDrawRuntime,
  setColorTableExtensionEnabled,
  setGlTexSolidFormat,
  setPalette8to24,
  setRawPalette,
  setRendererFlags as setDrawRendererFlags,
  setScrapDirty,
  setVidState,
  type GlDrawHooks,
  type GlDrawRuntime
} from "./gl_draw.js";
import {
  Mod_FreeAll,
  Mod_Init,
  Mod_Modellist_f,
  R_BeginRegistration,
  R_EndRegistration,
  R_RegisterModel,
  createGlModelRuntime,
  type GlModelRuntime
} from "./gl_model.js";
import { createRefGlBootstrap, type RefGlBootstrap, type RefGlBootstrapOptions } from "./ref-gl-bootstrap.js";
import type { QglProcedure } from "./qgl.js";

/**
 * Original name: N/A
 * Source: N/A (ref_gl host facade)
 * Category: New
 * Purpose: Describe optional runtimes and hook overrides used to compose the browser/Three ref_gl host.
 */
export interface RefGlHostOptions extends RefGlBootstrapOptions {
  imports?: Partial<refimport_t>;
  apiHooks?: GlRmainRefApiHooks;
  imageRuntime?: GlImageRuntime | null;
  glModelRuntime?: GlModelRuntime;
  drawRuntime?: GlDrawRuntime | null;
  drawHooks?: GlDrawHooks;
  warpRuntime?: GlWarpRuntime | null;
  rmiscRuntime?: GlRmiscRuntime;
  rmiscHooks?: GlRmiscHooks;
}

/**
 * Original name: N/A
 * Source: N/A (ref_gl host facade)
 * Category: New
 * Purpose: Expose the composed renderer bootstrap, import table, runtimes and classic refexport_t API.
 */
export interface RefGlHost extends RefGlBootstrap {
  refImport: refimport_t;
  rmiscRuntime: GlRmiscRuntime;
  imageRuntime: GlImageRuntime | null;
  glModelRuntime: GlModelRuntime;
  drawRuntime: GlDrawRuntime | null;
  api: refexport_t;
  init: (hinstance?: unknown, wndproc?: unknown) => boolean;
  shutdown: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (ref_gl host facade)
 * Category: New
 * Purpose: Build one minimal host object that exposes the classic renderer export table through the ported bootstrap path.
 *
 * Constraints:
 * - Must preserve the original `GetRefAPI` contract for host/client integration.
 * - Must let callers override only the imported services they actually need.
 */
export function createRefGlHost(options: RefGlHostOptions): RefGlHost {
  const refImport: refimport_t = {
    ...createRefImport(),
    ...options.imports
  };
  const imageRuntime = options.imageRuntime ?? null;
  const warpRuntime = options.warpRuntime ?? null;
  const drawRuntime = options.drawRuntime ?? createDefaultDrawRuntime(imageRuntime, refImport, options.drawHooks);
  let bootstrap: RefGlBootstrap;
  const rmiscHooks: GlRmiscHooks = {
    ...createQglRmiscHooks(() => bootstrap),
    ...(imageRuntime
      ? { loadPic: (name, pic, width, height, type, bits) => GL_LoadPic(imageRuntime, name, pic, width, height, type, bits) }
      : {}),
    setProtectedImages: (notexture, particletexture): void => {
      if (imageRuntime) {
        setProtectedImages(imageRuntime, notexture, particletexture);
      }
      if (bootstrap) {
        setRmainParticleTexture(bootstrap.runtime, particletexture);
      }
      options.rmiscHooks?.setProtectedImages?.(notexture, particletexture);
    },
    print: (printLevel, message) => refImport.Con_Printf(printLevel, message),
    ...options.rmiscHooks
  };
  const rmiscRuntime = options.rmiscRuntime ?? createGlRmiscRuntime(rmiscHooks);
  const glModelRuntime = options.glModelRuntime ?? createDefaultGlModelRuntime(refImport, imageRuntime);
  const userRuntimeHooks = options.hooks ?? {};

  bootstrap = createRefGlBootstrap({
    ...options,
    hooks: {
      ...userRuntimeHooks,
      drawGetPalette: () => {
        if (imageRuntime) {
          Draw_GetPalette(imageRuntime);
        }
        userRuntimeHooks.drawGetPalette?.();
      },
      glInitImages: () => {
        if (imageRuntime) {
          syncImageFromRmain(imageRuntime, bootstrap);
          GL_InitImages(imageRuntime);
        }
        userRuntimeHooks.glInitImages?.();
      },
      modInit: () => {
        Mod_Init(glModelRuntime);
        userRuntimeHooks.modInit?.();
      },
      glShutdownImages: () => {
        if (imageRuntime) {
          GL_ShutdownImages(imageRuntime);
        }
        userRuntimeHooks.glShutdownImages?.();
      },
      drawInitLocal: () => {
        if (drawRuntime) {
          syncDrawFromRmain(drawRuntime, imageRuntime, bootstrap);
          Draw_InitLocal(drawRuntime);
        }
        userRuntimeHooks.drawInitLocal?.();
      },
      glSetDefaultState: () => {
        syncRmiscFromRmain(rmiscRuntime, bootstrap, imageRuntime);
        GL_SetDefaultState(rmiscRuntime);
        userRuntimeHooks.glSetDefaultState?.();
      },
      rInitParticleTexture: () => {
        syncRmiscFromRmain(rmiscRuntime, bootstrap, imageRuntime);
        const textures = R_InitParticleTexture(rmiscRuntime);
        setRmainParticleTexture(bootstrap.runtime, textures.particletexture);
        userRuntimeHooks.rInitParticleTexture?.();
      },
      updateSwapInterval: () => {
        syncRmiscFromRmain(rmiscRuntime, bootstrap, imageRuntime);
        GL_UpdateSwapInterval(rmiscRuntime);
        userRuntimeHooks.updateSwapInterval?.();
      },
      modFreeAll: () => {
        Mod_FreeAll(glModelRuntime);
        userRuntimeHooks.modFreeAll?.();
      },
      textureMode: (mode) => {
        if (imageRuntime) {
          GL_TextureMode(imageRuntime, mode);
        }
        userRuntimeHooks.textureMode?.(mode);
      },
      textureAlphaMode: (mode) => {
        if (imageRuntime) {
          GL_TextureAlphaMode(imageRuntime, mode);
        }
        userRuntimeHooks.textureAlphaMode?.(mode);
      },
      textureSolidMode: (mode) => {
        if (imageRuntime) {
          GL_TextureSolidMode(imageRuntime, mode);
        }
        userRuntimeHooks.textureSolidMode?.(mode);
      },
      scaleTurbulence: (scale) => {
        if (warpRuntime) {
          setWarpTurbulenceScale(warpRuntime, scale);
        }
        userRuntimeHooks.scaleTurbulence?.(scale);
      }
    }
  });

  const drawApiHooks = drawRuntime ? createDrawApiHooks(drawRuntime, imageRuntime, () => bootstrap) : {};
  const defaultApiHooks: GlRmainRefApiHooks = {
    screenshotCommand: () => {
      syncRmiscFromRmain(rmiscRuntime, bootstrap, imageRuntime);
      GL_ScreenShot_f(rmiscRuntime, refImport.FS_Gamedir());
    },
    modellistCommand: () => {
      Mod_Modellist_f(glModelRuntime);
    },
    beginRegistration: (map) => {
      R_BeginRegistration(glModelRuntime, map);
    },
    registerModel: (name) => R_RegisterModel(glModelRuntime, name),
    ...(imageRuntime
      ? {
          registerSkin: (name) => R_RegisterSkin(imageRuntime, name),
          registerPic: (name) => {
            syncImageFromRmain(imageRuntime, bootstrap);
            return GL_FindImage(imageRuntime, resolvePicName(name), imagetype_t.it_pic);
          }
        }
      : {}),
    endRegistration: () => {
      R_EndRegistration(glModelRuntime);
    },
    glStringsCommand: () => {
      syncRmiscFromRmain(rmiscRuntime, bootstrap, imageRuntime);
      GL_Strings_f(rmiscRuntime);
    },
    ...drawApiHooks
  };
  const api = GetRefAPI(bootstrap.runtime, refImport, {
    ...defaultApiHooks,
    ...(options.apiHooks ?? {})
  });

  return {
    ...bootstrap,
    refImport,
    rmiscRuntime,
    imageRuntime,
    glModelRuntime,
    drawRuntime,
    api,
    init: (hinstance?: unknown, wndproc?: unknown) => api.Init(hinstance ?? null, wndproc ?? null),
    shutdown: () => {
      api.Shutdown();
    }
  };
}

function createDefaultGlModelRuntime(refImport: refimport_t, imageRuntime: GlImageRuntime | null): GlModelRuntime {
  return createGlModelRuntime({
    loadFile: (path) => refImport.FS_LoadFile(path),
    freeFile: (buffer) => {
      refImport.FS_FreeFile(buffer);
    },
    findImage: (name, type) => {
      if (!imageRuntime) {
        return null;
      }

      return GL_FindImage(imageRuntime, name, toImageType(type));
    },
    notextureImage: imageRuntime?.r_notexture ?? null,
    print: (message) => {
      refImport.Con_Printf(0, message);
    },
    getFlushMap: () => Boolean(refImport.Cvar_Get("flushmap", "0", 0)?.value ?? 0),
    setImageRegistration: (image, registrationSequence) => {
      if (image && typeof image === "object" && "registration_sequence" in image) {
        (image as { registration_sequence: number }).registration_sequence = registrationSequence;
      }
    },
    freeUnusedImages: () => {
      if (imageRuntime) {
        GL_FreeUnusedImages(imageRuntime);
      }
    }
  });
}

function toImageType(type: "wall" | "sprite" | "skin"): imagetype_t {
  switch (type) {
    case "skin":
      return imagetype_t.it_skin;
    case "sprite":
      return imagetype_t.it_sprite;
    case "wall":
      return imagetype_t.it_wall;
  }
}

function resolvePicName(name: string): string {
  if (name[0] !== "/" && name[0] !== "\\") {
    return truncateQPath(`pics/${name}.pcx`);
  }

  return name.slice(1);
}

function truncateQPath(path: string): string {
  if (path.length < MAX_QPATH) {
    return path;
  }

  return path.slice(0, MAX_QPATH - 1);
}

/**
 * Original name: N/A
 * Source: N/A (ref_gl draw host adapter)
 * Category: Adapter
 * Purpose: Bridge host import services and optional draw hooks into the ported gl_draw runtime.
 */
function createDefaultDrawRuntime(
  imageRuntime: GlImageRuntime | null,
  refImport: refimport_t,
  hooks: GlDrawHooks | undefined
): GlDrawRuntime | null {
  if (!imageRuntime && !hooks) {
    return null;
  }

  return createGlDrawRuntime({
    ...(imageRuntime
      ? {
          findImage: (name) => GL_FindImage(imageRuntime, name, imagetype_t.it_pic),
          uploadScrap: () => { Scrap_Upload(imageRuntime); },
          bindTexture: (texnum) => { GL_Bind(imageRuntime, texnum); }
        }
      : {}),
    Con_Printf: (printLevel, message) => refImport.Con_Printf(printLevel, message),
    Sys_Error: (errLevel, message) => {
      refImport.Sys_Error(errLevel, message);
      throw new Error(message);
    },
    ...hooks
  });
}

/**
 * Original name: N/A
 * Source: N/A (ref_gl draw API adapter)
 * Category: Adapter
 * Purpose: Wire refexport_t draw callbacks to the ported gl_draw entry points with current rmain state.
 */
function createDrawApiHooks(
  drawRuntime: GlDrawRuntime,
  imageRuntime: GlImageRuntime | null,
  getBootstrap: () => RefGlBootstrap
): Pick<GlRmainRefApiHooks,
  "drawGetPicSize" |
  "drawPic" |
  "drawStretchPic" |
  "drawChar" |
  "drawTileClear" |
  "drawFill" |
  "drawFadeScreen" |
  "drawStretchRaw"
> {
  const sync = (): void => {
    syncDrawFromRmain(drawRuntime, imageRuntime, getBootstrap());
  };

  return {
    drawGetPicSize: (name) => {
      sync();
      return Draw_GetPicSize(drawRuntime, name);
    },
    drawPic: (x, y, name) => {
      sync();
      Draw_Pic(drawRuntime, x, y, name);
    },
    drawStretchPic: (x, y, w, h, name) => {
      sync();
      Draw_StretchPic(drawRuntime, x, y, w, h, name);
    },
    drawChar: (x, y, c) => {
      sync();
      Draw_Char(drawRuntime, x, y, c);
    },
    drawTileClear: (x, y, w, h, name) => {
      sync();
      Draw_TileClear(drawRuntime, x, y, w, h, name);
    },
    drawFill: (x, y, w, h, c) => {
      sync();
      Draw_Fill(drawRuntime, x, y, w, h, c);
    },
    drawFadeScreen: () => {
      sync();
      Draw_FadeScreen(drawRuntime);
    },
    drawStretchRaw: (x, y, w, h, cols, rows, data) => {
      sync();
      Draw_StretchRaw(drawRuntime, x, y, w, h, cols, rows, data);
    }
  };
}

/**
 * Original name: N/A
 * Source: N/A (ref_gl image runtime sync adapter)
 * Category: Adapter
 * Purpose: Copy relevant rmain renderer state into the ported gl_image runtime before image operations.
 */
function syncImageFromRmain(imageRuntime: GlImageRuntime, bootstrap: RefGlBootstrap): void {
  const rmain = bootstrap.runtime;
  setImageRendererFlags(imageRuntime, rmain.gl_renderer);
  setNoBindEnabled(imageRuntime, Boolean(rmain.gl_nobind?.value ?? false));
  setPaletteExtensionState(imageRuntime, rmain.qglColorTableEXT, Boolean(rmain.gl_ext_palettedtexture?.value ?? true));
  setRoundDownEnabled(imageRuntime, Boolean(rmain.gl_round_down?.value ?? true));
  setPicmipValue(imageRuntime, rmain.gl_picmip?.value ?? 0);
  setVidGammaValue(imageRuntime, rmain.vid_gamma?.value ?? 1);
  setIntensityValue(imageRuntime, imageRuntime.intensity_value);
}

/**
 * Original name: N/A
 * Source: N/A (ref_gl draw runtime sync adapter)
 * Category: Adapter
 * Purpose: Copy current rmain/image state into the ported gl_draw runtime before draw API callbacks.
 */
function syncDrawFromRmain(
  drawRuntime: GlDrawRuntime,
  imageRuntime: GlImageRuntime | null,
  bootstrap: RefGlBootstrap
): void {
  const rmain = bootstrap.runtime;
  setVidState(drawRuntime, rmain.vid.width, rmain.vid.height);
  setDrawRendererFlags(drawRuntime, rmain.gl_renderer);
  setPalette8to24(drawRuntime, imageRuntime?.d_8to24table ?? rmain.d_8to24table);
  setRawPalette(drawRuntime, rmain.rawpalette);
  setScrapDirty(drawRuntime, imageRuntime?.scrap_dirty ?? drawRuntime.scrap_dirty);
  setColorTableExtensionEnabled(drawRuntime, imageRuntime?.qglColorTableEXT ?? rmain.qglColorTableEXT);
  setGlTexSolidFormat(drawRuntime, imageRuntime?.gl_tex_solid_format ?? drawRuntime.gl_tex_solid_format);
  if (imageRuntime?.draw_chars) {
    drawRuntime.draw_chars = imageRuntime.draw_chars;
  }
}

/**
 * Original name: N/A
 * Source: N/A (ref_gl rmisc runtime sync adapter)
 * Category: Adapter
 * Purpose: Copy current rmain/image state into the ported gl_rmisc runtime before miscellaneous GL operations.
 */
function syncRmiscFromRmain(
  rmiscRuntime: GlRmiscRuntime,
  bootstrap: RefGlBootstrap,
  imageRuntime: GlImageRuntime | null
): void {
  const rmain = bootstrap.runtime;
  setRmiscVid(rmiscRuntime, rmain.vid.width, rmain.vid.height);
  setRmiscGlConfig(rmiscRuntime, {
    renderer: rmain.gl_renderer,
    renderer_string: rmain.gl_renderer_string,
    vendor_string: rmain.gl_vendor_string,
    version_string: rmain.gl_version_string,
    extensions_string: rmain.gl_extensions_string,
    allow_cds: rmain.gl_allow_cds
  });
  setRmiscGlState(rmiscRuntime, rmain.gl_state);
  setRmiscImageRuntime(rmiscRuntime, imageRuntime);
  syncRmiscExtensionStateFromRmain(rmiscRuntime, rmain);
  setRmiscCvars(rmiscRuntime, {
    gl_texturemode: rmain.gl_texturemode,
    gl_texturealphamode: rmain.gl_texturealphamode,
    gl_texturesolidmode: rmain.gl_texturesolidmode,
    gl_particle_att_a: rmain.gl_particle_att_a,
    gl_particle_att_b: rmain.gl_particle_att_b,
    gl_particle_att_c: rmain.gl_particle_att_c,
    gl_particle_min_size: rmain.gl_particle_min_size,
    gl_particle_max_size: rmain.gl_particle_max_size,
    gl_ext_palettedtexture: rmain.gl_ext_palettedtexture,
    gl_swapinterval: rmain.gl_swapinterval
  });
}

/**
 * Original name: N/A
 * Source: N/A (ref_gl qgl host adapter)
 * Category: Adapter
 * Purpose: Adapt qgl/qwgl procedure symbols exposed by the bootstrap into gl_rmisc hook callbacks.
 */
function createQglRmiscHooks(getBootstrap: () => RefGlBootstrap): GlRmiscHooks {
  const callQgl = (name: string, ...args: unknown[]): unknown => {
    const symbols = getBootstrap().qglRuntime.symbols as unknown as Record<string, unknown>;
    const proc = symbols[name];
    return typeof proc === "function" ? (proc as QglProcedure)(...args) : undefined;
  };

  return {
    readPixels: (x, y, width, height, format, type) => {
      const pixels = callQgl("qglReadPixels", x, y, width, height, format, type);
      return pixels instanceof Uint8Array ? pixels : new Uint8Array(width * height * 3);
    },
    clearColor: (red, green, blue, alpha) => { callQgl("qglClearColor", red, green, blue, alpha); },
    cullFace: (mode) => { callQgl("qglCullFace", mode); },
    enable: (cap) => { callQgl("qglEnable", cap); },
    disable: (cap) => { callQgl("qglDisable", cap); },
    alphaFunc: (func, ref) => { callQgl("qglAlphaFunc", func, ref); },
    color4f: (red, green, blue, alpha) => { callQgl("qglColor4f", red, green, blue, alpha); },
    polygonMode: (face, mode) => { callQgl("qglPolygonMode", face, mode); },
    shadeModel: (mode) => { callQgl("qglShadeModel", mode); },
    texParameterf: (target, pname, value) => { callQgl("qglTexParameterf", target, pname, value); },
    blendFunc: (sfactor, dfactor) => { callQgl("qglBlendFunc", sfactor, dfactor); },
    pointParameterfEXT: (pname, value) => { callQgl("qglPointParameterfEXT", pname, value); },
    pointParameterfvEXT: (pname, values) => { callQgl("qglPointParameterfvEXT", pname, values); },
    updateSwapInterval: (value) => {
      const qwglRuntime = getBootstrap().qwglRuntime;
      const proc = qwglRuntime?.symbols.qwglSwapIntervalEXT;
      if (typeof proc === "function") {
        proc(value);
      }
    }
  };
}
