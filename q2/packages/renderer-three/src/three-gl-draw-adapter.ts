/**
 * File: three-gl-draw-adapter.ts
 * Purpose: Adapt the ported `ref_gl/gl_draw.c` hook surface to a Three.js HUD scene.
 *
 * This file is not a direct source port.
 * It is an adapter layer between `GlDrawHooks` / `GlImageHooks` and Three.js.
 *
 * Dependencies:
 * - packages/renderer-three/src/gl_draw.ts
 * - packages/renderer-three/src/gl_image.ts
 * - three
 */

import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  Texture,
  UnsignedByteType,
  Vector3,
  type MagnificationTextureFilter,
  type MinificationTextureFilter
} from "three";
import type { GlDrawHooks, GlDrawQuad, GlDrawRawUpload } from "./gl_draw.js";
import type { GlImageHooks } from "./gl_image.js";

/**
 * Original name: N/A
 * Source: N/A (Three.js HUD adapter)
 * Category: New
 * Purpose: Expose the Three.js state and hook bundles needed by the classic `gl_draw` path.
 */
export interface ThreeGlDrawAdapter {
  scene: Scene;
  camera: OrthographicCamera;
  root: Group;
  drawHooks: GlDrawHooks;
  imageHooks: Pick<
    GlImageHooks,
    "bindTexture" | "setTextureFilter" | "deleteTexture" | "uploadTextureData" | "uploadScrapTexture" | "setSharedTexturePalette"
  >;
  setViewport: (width: number, height: number) => void;
  clear: () => void;
  setTexture: (texnum: number, texture: Texture) => void;
  getTexture: (texnum: number) => Texture | null;
  setPaletteRgb: (paletteRgb: Uint8Array | null) => void;
  dispose: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js HUD adapter)
 * Category: New
 * Purpose: Create a Three.js HUD adapter for the ported `gl_draw.c` immediate-mode hooks.
 *
 * Constraints:
 * - Must preserve Quake II top-left pixel coordinates.
 * - Must keep texture upload and draw emission separate so it can plug into `createRefGlHost`.
 */
export function createThreeGlDrawAdapter(): ThreeGlDrawAdapter {
  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1, 1, 0, -100, 100);
  const root = new Group();
  const textures = new Map<number, Texture>();
  const filterState = new Map<number, TextureFilterState>();
  const state = {
    viewportWidth: 1,
    viewportHeight: 1,
    currentTexnum: 0,
    textureEnabled: true,
    blendEnabled: false,
    alphaTestEnabled: true,
    color: [1, 1, 1, 1] as [number, number, number, number],
    paletteRgb: null as Uint8Array | null,
    drawOrder: 0
  };

  scene.add(root);

  const adapter: ThreeGlDrawAdapter = {
    scene,
    camera,
    root,
    drawHooks: {
      bindTexture: (texnum) => {
        state.currentTexnum = texnum;
      },
      setTextureFilter: (texnum, minFilter, magFilter) => {
        setTextureFilter(textures, filterState, texnum, toThreeFilter(minFilter), toThreeFilter(magFilter));
      },
      setAlphaTestEnabled: (enabled) => {
        state.alphaTestEnabled = enabled;
      },
      setTextureEnabled: (enabled) => {
        state.textureEnabled = enabled;
      },
      setBlendEnabled: (enabled) => {
        state.blendEnabled = enabled;
      },
      setDrawColor: (red, green, blue, alpha) => {
        state.color = [red, green, blue, alpha];
      },
      drawTexturedQuad: (quad) => {
        const texture = state.textureEnabled ? textures.get(state.currentTexnum) : null;
        if (!texture) {
          return;
        }

        const mesh = createTexturedQuad(quad, texture, state.viewportHeight, state.alphaTestEnabled, state.blendEnabled);
        mesh.renderOrder = state.drawOrder;
        state.drawOrder += 1;
        root.add(mesh);
      },
      drawSolidQuad: (x, y, width, height) => {
        const mesh = createSolidQuad(x, y, width, height, state.viewportHeight, state.color, state.blendEnabled);
        mesh.renderOrder = state.drawOrder;
        state.drawOrder += 1;
        root.add(mesh);
      },
      uploadRawTexture: (upload) => {
        const texture = createTextureFromUpload(upload, state.paletteRgb);
        applyStoredFilter(texture, filterState.get(state.currentTexnum));
        replaceTexture(textures, state.currentTexnum, texture);
      }
    },
    imageHooks: {
      bindTexture: (texnum) => {
        state.currentTexnum = texnum;
      },
      setTextureFilter: (texnum, minFilter, magFilter) => {
        setTextureFilter(textures, filterState, texnum, toThreeGlMinFilter(minFilter), toThreeGlMagFilter(magFilter));
      },
      deleteTexture: (texnum) => {
        const texture = textures.get(texnum);
        texture?.dispose();
        textures.delete(texnum);
        filterState.delete(texnum);
      },
      uploadTextureData: (upload) => {
        if (upload.level !== 0) {
          return;
        }

        const texture = createTextureFromUpload(upload, state.paletteRgb);
        applyStoredFilter(texture, filterState.get(state.currentTexnum));
        replaceTexture(textures, state.currentTexnum, texture);
      },
      uploadScrapTexture: (texnum, width, height, data) => {
        const texture = createIndexedTexture(data, width, height, state.paletteRgb);
        applyStoredFilter(texture, filterState.get(texnum));
        replaceTexture(textures, texnum, texture);
      },
      setSharedTexturePalette: (paletteRgb) => {
        state.paletteRgb = paletteRgb.slice();
      }
    },
    setViewport: (width, height) => {
      state.viewportWidth = Math.max(1, width);
      state.viewportHeight = Math.max(1, height);
      camera.left = 0;
      camera.right = state.viewportWidth;
      camera.top = state.viewportHeight;
      camera.bottom = 0;
      camera.position.set(0, 0, 10);
      camera.lookAt(new Vector3(0, 0, 0));
      camera.updateProjectionMatrix();
    },
    clear: () => {
      clearGroup(root);
      state.drawOrder = 0;
    },
    setTexture: (texnum, texture) => {
      applyStoredFilter(texture, filterState.get(texnum));
      replaceTexture(textures, texnum, texture);
    },
    getTexture: (texnum) => textures.get(texnum) ?? null,
    setPaletteRgb: (paletteRgb) => {
      state.paletteRgb = paletteRgb ? paletteRgb.slice() : null;
    },
    dispose: () => {
      clearGroup(root);
      for (const texture of textures.values()) {
        texture.dispose();
      }
      textures.clear();
      filterState.clear();
    }
  };

  adapter.setViewport(1, 1);
  return adapter;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js HUD adapter)
 * Category: New
 * Purpose: Convert one `GlDrawQuad` hook emission into a textured Three.js mesh.
 */
function createTexturedQuad(
  quad: GlDrawQuad,
  sourceTexture: Texture,
  viewportHeight: number,
  alphaTestEnabled: boolean,
  blendEnabled: boolean
): Mesh<BufferGeometry, MeshBasicMaterial> {
  const uv = adjustGlyphAtlasUv(quad, sourceTexture);
  const geometry = createQuadGeometry(quad.width, quad.height, uv.sl, uv.tl, uv.sh, uv.th);
  const material = new MeshBasicMaterial({
    map: sourceTexture,
    transparent: true,
    alphaTest: alphaTestEnabled ? 0.5 : 0,
    depthTest: false,
    depthWrite: false
  });
  material.opacity = blendEnabled ? 0.8 : 1;

  const mesh = new Mesh(geometry, material);
  mesh.position.set(quad.x + quad.width / 2, viewportHeight - (quad.y + quad.height / 2), 0);
  return mesh;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js glyph atlas sampling adapter)
 * Category: New
 * Purpose: Keep 8x8 console glyphs from sampling adjacent `conchars` cells on WebGL backends.
 *
 * Constraints:
 * - Must only affect the 16x16, 128x128 `conchars` glyph atlas path.
 * - Must preserve picture and scrap atlas UVs unchanged.
 */
function adjustGlyphAtlasUv(
  quad: GlDrawQuad,
  sourceTexture: Texture
): Pick<GlDrawQuad, "sl" | "tl" | "sh" | "th"> {
  const image = sourceTexture.image as { width?: number; height?: number } | undefined;
  const textureWidth = typeof image?.width === "number" ? image.width : 0;
  const textureHeight = typeof image?.height === "number" ? image.height : 0;
  const cellWidth = Math.abs(quad.sh - quad.sl) * textureWidth;
  const cellHeight = Math.abs(quad.th - quad.tl) * textureHeight;
  const isConcharsGlyph =
    quad.width === 8
    && quad.height === 8
    && textureWidth === 128
    && textureHeight === 128
    && Math.abs(cellWidth - 8) < 0.001
    && Math.abs(cellHeight - 8) < 0.001;

  if (!isConcharsGlyph) {
    return {
      sl: quad.sl,
      tl: quad.tl,
      sh: quad.sh,
      th: quad.th
    };
  }

  const halfTexelU = 0.5 / textureWidth;
  const halfTexelV = 0.5 / textureHeight;
  return {
    sl: quad.sl + halfTexelU,
    tl: quad.tl + halfTexelV,
    sh: quad.sh - halfTexelU,
    th: quad.th - halfTexelV
  };
}

/**
 * Original name: N/A
 * Source: N/A (Three.js HUD adapter)
 * Category: New
 * Purpose: Convert one fill-rectangle hook emission into a solid Three.js mesh.
 */
function createSolidQuad(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportHeight: number,
  color: readonly [number, number, number, number],
  blendEnabled: boolean
): Mesh<BufferGeometry, MeshBasicMaterial> {
  const geometry = createQuadGeometry(width, height, 0, 0, 1, 1);
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    opacity: color[3],
    transparent: blendEnabled || color[3] < 1,
    depthTest: false,
    depthWrite: false
  });
  material.color.setRGB(color[0], color[1], color[2]);

  const mesh = new Mesh(geometry, material);
  mesh.position.set(x + width / 2, viewportHeight - (y + height / 2), 0);
  return mesh;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js HUD adapter)
 * Category: New
 * Purpose: Build the shared quad geometry used by HUD textured and solid draws.
 */
function createQuadGeometry(width: number, height: number, sl: number, tl: number, sh: number, th: number): BufferGeometry {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([
    -halfWidth, -halfHeight, 0,
    halfWidth, -halfHeight, 0,
    -halfWidth, halfHeight, 0,
    halfWidth, halfHeight, 0
  ]), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array([
    sl, th,
    sh, th,
    sl, tl,
    sh, tl
  ]), 2));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  return geometry;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js texture adapter)
 * Category: New
 * Purpose: Convert draw/image upload hook payloads into a Three.js `DataTexture`.
 */
function createTextureFromUpload(upload: GlDrawRawUpload | {
  width: number;
  height: number;
  data: Uint8Array | Uint32Array;
}, paletteRgb: Uint8Array | null): DataTexture {
  const rgba = upload.data instanceof Uint32Array
    ? packedRgbaToBytes(upload.data, upload.width, upload.height)
    : indexedOrRgbaToBytes(upload.data, upload.width, upload.height, paletteRgb);
  const texture = new DataTexture(rgba, upload.width, upload.height, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js texture adapter)
 * Category: New
 * Purpose: Convert one paletted scrap upload into a Three.js `DataTexture`.
 */
function createIndexedTexture(indices: Uint8Array, width: number, height: number, paletteRgb: Uint8Array | null): DataTexture {
  const texture = new DataTexture(indexedToRgba(indices, paletteRgb), width, height, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Original name: N/A
 * Source: N/A (RGBA conversion helper)
 * Category: New
 * Purpose: Repack Quake-style 32-bit RGBA pixels into byte data accepted by Three.js.
 */
function packedRgbaToBytes(source: Uint32Array, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < Math.min(source.length, width * height); index += 1) {
    const value = source[index] ?? 0;
    const offset = index * 4;
    rgba[offset] = value & 0xff;
    rgba[offset + 1] = (value >> 8) & 0xff;
    rgba[offset + 2] = (value >> 16) & 0xff;
    rgba[offset + 3] = (value >>> 24) & 0xff;
  }
  return rgba;
}

/**
 * Original name: N/A
 * Source: N/A (RGBA conversion helper)
 * Category: New
 * Purpose: Normalize either direct RGBA bytes or indexed pixels into RGBA byte data.
 */
function indexedOrRgbaToBytes(source: Uint8Array, width: number, height: number, paletteRgb: Uint8Array | null): Uint8Array {
  if (source.length >= width * height * 4) {
    return source.slice(0, width * height * 4);
  }

  return indexedToRgba(source, paletteRgb);
}

/**
 * Original name: N/A
 * Source: N/A (RGBA conversion helper)
 * Category: New
 * Purpose: Expand Quake indexed pixels through the shared palette, preserving index 255 transparency.
 */
function indexedToRgba(indices: Uint8Array, paletteRgb: Uint8Array | null): Uint8Array {
  const rgba = new Uint8Array(indices.length * 4);
  for (let index = 0; index < indices.length; index += 1) {
    const paletteIndex = indices[index] ?? 0;
    const offset = index * 4;
    if (paletteRgb) {
      const sourceOffset = paletteIndex * 3;
      rgba[offset] = paletteRgb[sourceOffset] ?? 0;
      rgba[offset + 1] = paletteRgb[sourceOffset + 1] ?? 0;
      rgba[offset + 2] = paletteRgb[sourceOffset + 2] ?? 0;
    } else {
      rgba[offset] = paletteIndex;
      rgba[offset + 1] = paletteIndex;
      rgba[offset + 2] = paletteIndex;
    }
    rgba[offset + 3] = paletteIndex === 255 ? 0 : 255;
  }
  return rgba;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js texture adapter)
 * Category: New
 * Purpose: Store and apply backend texture filter state for Three.js textures.
 */
function setTextureFilter(
  textures: Map<number, Texture>,
  filterState: Map<number, TextureFilterState>,
  texnum: number,
  minFilter: MinificationTextureFilter,
  magFilter: MagnificationTextureFilter
): void {
  filterState.set(texnum, { minFilter, magFilter });
  const texture = textures.get(texnum);
  if (texture) {
    applyStoredFilter(texture, { minFilter, magFilter });
  }
}

/**
 * Original name: N/A
 * Source: N/A (Three.js texture adapter)
 * Category: New
 * Purpose: Apply a previously stored min/mag filter pair to a Three.js texture.
 */
function applyStoredFilter(texture: Texture, filter: TextureFilterState | undefined): void {
  if (!filter) {
    return;
  }

  texture.minFilter = filter.minFilter;
  texture.magFilter = filter.magFilter;
  texture.needsUpdate = true;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js filter adapter)
 * Category: New
 * Purpose: Convert the `gl_draw.ts` hook filter names to Three.js filter constants.
 */
function toThreeFilter(filter: "nearest" | "linear"): MinificationTextureFilter & MagnificationTextureFilter {
  return filter === "nearest" ? NearestFilter : LinearFilter;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js filter adapter)
 * Category: New
 * Purpose: Convert OpenGL minification filter enum values from `gl_image.ts` hooks to Three.js filters.
 */
function toThreeGlMinFilter(filter: number): MinificationTextureFilter {
  switch (filter) {
    case 0x2600:
    case 0x2700:
    case 0x2702:
      return NearestFilter;
    case 0x2601:
    case 0x2701:
    case 0x2703:
    default:
      return LinearFilter;
  }
}

/**
 * Original name: N/A
 * Source: N/A (Three.js filter adapter)
 * Category: New
 * Purpose: Convert OpenGL magnification filter enum values from `gl_image.ts` hooks to Three.js filters.
 */
function toThreeGlMagFilter(filter: number): MagnificationTextureFilter {
  return filter === 0x2600 ? NearestFilter : LinearFilter;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js texture adapter)
 * Category: New
 * Purpose: Replace one backend texture slot and dispose the previous Three.js texture.
 */
function replaceTexture(textures: Map<number, Texture>, texnum: number, texture: Texture): void {
  const old = textures.get(texnum);
  if (old && old !== texture) {
    old.dispose();
  }
  textures.set(texnum, texture);
}

/**
 * Original name: N/A
 * Source: N/A (Three.js HUD adapter)
 * Category: New
 * Purpose: Dispose all transient HUD meshes owned by the adapter root group.
 */
function clearGroup(root: Group): void {
  for (const child of [...root.children]) {
    root.remove(child);
    if (child instanceof Mesh) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        material.dispose();
      }
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (Three.js texture adapter)
 * Category: New
 * Purpose: Remember the Three.js min/mag filter pair associated with one texture slot.
 */
interface TextureFilterState {
  minFilter: MinificationTextureFilter;
  magFilter: MagnificationTextureFilter;
}
