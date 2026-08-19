/**
 * File: quake-sky-resolver.ts
 * Purpose: Resolve Quake II sky environment resources from the virtual filesystem and expose them as canonical face sets plus Three.js textures.
 *
 * This file is not a direct source port.
 * It is an adapter layer between Quake II sky assets and the Three.js backend.
 *
 * Dependencies:
 * - packages/filesystem
 * - packages/formats
 * - packages/renderer-common
 * - three
 */

import { readMountedFile, type VirtualFilesystem } from "../../filesystem/src/index.js";
import { parsePcx, parseTga } from "../../formats/src/index.js";
import {
  QUAKE_SKY_FACE_SUFFIXES,
  type QuakeSkyAssetSet,
  type QuakeSkyFaceName
} from "../../renderer-common/src/index.js";
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture
} from "three";

/**
 * Original name: N/A
 * Source: N/A (sky texture palette path)
 * Category: New
 * Purpose: Locate the shared Quake II PCX palette for indexed sky faces.
 */
const SHARED_PALETTE_PATH = "pics/colormap.pcx";

/**
 * Original name: N/A
 * Source: N/A (renderer sky resolver contract)
 * Category: New
 * Purpose: Describe one fully loaded Quake II sky face texture set.
 *
 * Constraints:
 * - Must preserve the canonical Quake face ordering and source paths.
 */
export interface LoadedQuakeSkyTextureSet {
  assets: QuakeSkyAssetSet;
  textures: Record<QuakeSkyFaceName, Texture>;
}

/**
 * Original name: N/A
 * Source: N/A (renderer sky resolver contract)
 * Category: New
 * Purpose: Expose reusable Quake II sky resolution helpers for later renderer integration.
 *
 * Constraints:
 * - Must cache decoded sky sets by sky name.
 * - Must return `null` when any required face is unavailable or undecodable.
 */
export interface QuakeSkyResolver {
  resolveAssetSet: (skyName: string) => QuakeSkyAssetSet | null;
  resolveTextureSet: (skyName: string) => LoadedQuakeSkyTextureSet | null;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky asset resolver)
 * Category: Adapter
 * Purpose: Build a resolver for Quake II sky environment resources stored in the mounted virtual filesystem.
 *
 * Constraints:
 * - Must use the original face suffix order.
 * - Must tolerate missing sky resources without throwing.
 */
export function createQuakeSkyResolver(filesystem: VirtualFilesystem): QuakeSkyResolver {
  const assetCache = new Map<string, QuakeSkyAssetSet | null>();
  const textureCache = new Map<string, LoadedQuakeSkyTextureSet | null>();
  let paletteRgb: Uint8Array | null | undefined;

  return {
    resolveAssetSet: (skyName) => {
      if (assetCache.has(skyName)) {
        return assetCache.get(skyName) ?? null;
      }

      const assetSet = buildSkyAssetSet(filesystem, skyName);
      assetCache.set(skyName, assetSet);
      return assetSet;
    },
    resolveTextureSet: (skyName) => {
      if (textureCache.has(skyName)) {
        return textureCache.get(skyName) ?? null;
      }

      const assetSet = assetCache.has(skyName)
        ? assetCache.get(skyName) ?? null
        : buildSkyAssetSet(filesystem, skyName);
      assetCache.set(skyName, assetSet);
      if (!assetSet) {
        textureCache.set(skyName, null);
        return null;
      }

      if (paletteRgb === undefined) {
        paletteRgb = loadSharedPalette(filesystem);
      }

      const textures = {} as Record<QuakeSkyFaceName, Texture>;
      for (const faceName of QUAKE_SKY_FACE_SUFFIXES) {
        const assetPath = assetSet.faces[faceName];
        const texture = loadSkyTexture(filesystem, assetPath, paletteRgb ?? null);
        if (!texture) {
          textureCache.set(skyName, null);
          return null;
        }

        textures[faceName] = texture;
      }

      const loaded = {
        assets: assetSet,
        textures
      };
      textureCache.set(skyName, loaded);
      return loaded;
    }
  };
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky asset resolver)
 * Category: Adapter
 * Purpose: Build the canonical six-face asset-path set for one Quake II sky name.
 *
 * Constraints:
 * - Must preserve the original Quake suffix order.
 * - Must prefer TGA resources when present, with PCX fallback.
 */
function buildSkyAssetSet(filesystem: VirtualFilesystem, skyName: string): QuakeSkyAssetSet | null {
  if (skyName.length === 0) {
    return null;
  }

  const faces = {} as Record<QuakeSkyFaceName, string>;
  for (const faceName of QUAKE_SKY_FACE_SUFFIXES) {
    const assetPath = resolveSkyFacePath(filesystem, skyName, faceName);
    if (!assetPath) {
      return null;
    }

    faces[faceName] = assetPath;
  }

  return {
    name: skyName,
    faces
  };
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky asset resolver)
 * Category: Adapter
 * Purpose: Resolve one sky face path using Quake II's `env/<sky><suffix>` naming convention.
 *
 * Constraints:
 * - Must try `.tga` first and `.pcx` second for the current renderer path.
 */
function resolveSkyFacePath(filesystem: VirtualFilesystem, skyName: string, faceName: QuakeSkyFaceName): string | null {
  const candidates = [
    `env/${skyName}${faceName}.tga`,
    `env/${skyName}${faceName}.pcx`
  ];

  for (const candidate of candidates) {
    if (readMountedFile(filesystem, candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky palette loader)
 * Category: Adapter
 * Purpose: Load the shared Quake II palette needed to decode PCX sky faces.
 *
 * Constraints:
 * - Must return null when the palette source is unavailable.
 */
function loadSharedPalette(filesystem: VirtualFilesystem): Uint8Array | null {
  const paletteFile = readMountedFile(filesystem, SHARED_PALETTE_PATH);
  if (!paletteFile) {
    return null;
  }

  try {
    return parsePcx(paletteFile.bytes, paletteFile.path).paletteRgb;
  } catch {
    return null;
  }
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky texture loader)
 * Category: Adapter
 * Purpose: Load one sky face texture from either TGA or PCX data.
 *
 * Constraints:
 * - Must return null on decode failure instead of breaking the caller.
 */
function loadSkyTexture(filesystem: VirtualFilesystem, assetPath: string, paletteRgb: Uint8Array | null): Texture | null {
  const file = readMountedFile(filesystem, assetPath);
  if (!file) {
    return null;
  }

  try {
    if (assetPath.endsWith(".tga")) {
      const image = parseTga(file.bytes, file.path);
      return createSkyTexture(image.width, image.height, image.rgba);
    }

    if (assetPath.endsWith(".pcx") && paletteRgb !== null) {
      const image = parsePcx(file.bytes, file.path);
      return createSkyTexture(image.width, image.height, expandIndexedRgba(image.indices, paletteRgb));
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Original name: N/A
 * Source: N/A (indexed image expansion helper)
 * Category: New
 * Purpose: Expand one indexed Quake image into an RGBA buffer.
 */
function expandIndexedRgba(indices: Uint8Array, paletteRgb: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(indices.length * 4);

  for (let index = 0; index < indices.length; index += 1) {
    const paletteIndex = indices[index] * 3;
    const rgbaIndex = index * 4;
    rgba[rgbaIndex] = paletteRgb[paletteIndex];
    rgba[rgbaIndex + 1] = paletteRgb[paletteIndex + 1];
    rgba[rgbaIndex + 2] = paletteRgb[paletteIndex + 2];
    rgba[rgbaIndex + 3] = 255;
  }

  return rgba;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky texture factory)
 * Category: Adapter
 * Purpose: Convert one decoded sky face into a clamp-to-edge Three.js texture.
 *
 * Constraints:
 * - Must keep sky textures untiled and renderer-ready for both WebGPU and WebGL paths.
 */
function createSkyTexture(width: number, height: number, rgba: Uint8Array): Texture {
  const texture = new DataTexture(rgba, width, height, RGBAFormat, UnsignedByteType);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  texture.userData.quake = {
    width,
    height,
    kind: "sky"
  };
  return texture;
}
