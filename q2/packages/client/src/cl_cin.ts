/**
 * File: cl_cin.ts
 * Source: Quake II original / client/cl_cin.c
 * Purpose: Port of client-side cinematic loading, decoding and timing routines.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses typed arrays and explicit runtime state instead of raw C pointers/files.
 * - Defers CD audio, sound restart and final full-screen upload to host hooks.
 *
 * Notes:
 * - This file is intended to stay close to the original `cl_cin.c` responsibilities.
 */

import {
  MSG_WriteByte,
  MSG_WriteString,
  clc_ops_e
} from "../../qcommon/src/index.js";
import { parsePcx } from "../../formats/src/index.js";
import type {
  HudDrawCommand
} from "./render-contracts.js";
import type { refexport_t } from "./ref.js";
import { connstate_t, type ClientRuntime } from "./client.js";

/**
 * Original name: N/A
 * Source declaree: N/A (renderer-facing adapter shape)
 * Category: New
 * Purpose: Describe one active cinematic frame ready for a renderer adapter.
 *
 * Constraints:
 * - Must keep indexed pixels and the active palette explicit for faithful renderer-side upload.
 */
export interface ClientCinematicSnapshot {
  kind: "pcx-static" | "cinematic";
  name: string;
  width: number;
  height: number;
  pixels: Uint8Array;
  paletteRgb: Uint8Array;
}

/**
 * Original name: N/A
 * Source declaree: N/A (host callback adapter shape)
 * Category: New
 * Purpose: Describe the host callbacks needed by the current cinematic port.
 *
 * Constraints:
 * - Must keep file access and raw audio forwarding explicit.
 */
export interface ClientScreenHooks {
  loadBinaryFile?: (path: string) => Uint8Array | null;
  onCinematicRawSamples?: (
    count: number,
    sampleRate: number,
    sampleWidth: number,
    channels: number,
    samples: Uint8Array
  ) => void;
  onCDAudioStop?: () => void;
  onCinematicSoundRestart?: (targetKhz?: number) => void;
  getCurrentSoundKhz?: () => number;
}

/**
 * Original name: N/A
 * Source declaree: N/A (screen bridge adapter shape)
 * Category: New
 * Purpose: Describe the minimal screen callbacks the cinematic port needs from `screen.ts`.
 *
 * Constraints:
 * - Must keep screen/HUD ownership in `screen.ts` while allowing `cl_cin.c` logic to live here.
 */
export interface ClientCinematicScreenBridge {
  SCR_BeginLoadingPlaque: (runtime: ClientRuntime) => void;
  SCR_EndLoadingPlaque: (runtime: ClientRuntime) => void;
}

/**
 * Original name: SCR_StopCinematic
 * Source: client/cl_cin.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Clears the active cinematic state and returns the client to non-cinematic drawing.
 *
 * Porting notes:
 * - Defers sound backend restart side effects to host hooks.
 */
export function SCR_StopCinematic(runtime: ClientRuntime, hooks: ClientScreenHooks = {}): void {
  runtime.cl.cinematic.cinematictime = 0;
  runtime.cl.cinematic.cinematicframe = 0;
  runtime.cl.cinematic.pic = null;
  runtime.cl.cinematic.pic_pending = null;
  runtime.cl.cinematic.width = 0;
  runtime.cl.cinematic.height = 0;
  runtime.cl.cinematic.kind = "none";
  runtime.cl.cinematic.name = "";
  runtime.cl.cinematic.cinematicpalette_active = false;
  runtime.cl.cinematic.file = null;
  runtime.cl.cinematic.file_position = 0;
  runtime.cl.cinematic.s_rate = 0;
  runtime.cl.cinematic.s_width = 0;
  runtime.cl.cinematic.s_channels = 0;
  runtime.cl.cinematic.hnodes1 = null;
  runtime.cl.cinematic.numhnodes1.fill(0);

  if (runtime.cl.cinematic.restart_sound) {
    runtime.cl.cinematic.restart_sound = false;
    hooks.onCinematicSoundRestart?.();
  }
}

/**
 * Original name: SCR_FinishCinematic
 * Source: client/cl_cin.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Queues the original `nextserver` string command so the server can advance after a cinematic.
 */
export function SCR_FinishCinematic(runtime: ClientRuntime): void {
  MSG_WriteByte(runtime.cls.netchan.message, clc_ops_e.clc_stringcmd);
  MSG_WriteString(runtime.cls.netchan.message, `nextserver ${runtime.cl.servercount}\n`);
}

/**
 * Original name: SCR_RunCinematic
 * Source: client/cl_cin.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances the active cinematic timeline for static `.pcx` and streamed `.cin` cinematics.
 *
 * Porting notes:
 * - Static PCX cinematics intentionally remain on screen until replaced or stopped, matching `cinematicframe == -1`.
 */
export function SCR_RunCinematic(
  runtime: ClientRuntime,
  screenBridge: ClientCinematicScreenBridge,
  options: {
    keyDest?: "game" | "console" | "message" | "menu";
    currentTimeMs?: number;
  } = {},
  hooks: ClientScreenHooks = {}
): void {
  if (runtime.cl.cinematic.cinematictime <= 0) {
    SCR_StopCinematic(runtime, hooks);
    return;
  }

  if (runtime.cl.cinematic.cinematicframe === -1) {
    return;
  }

  if (options.keyDest !== undefined && options.keyDest !== "game") {
    runtime.cl.cinematic.cinematictime = (options.currentTimeMs ?? runtime.cls.realtime) - runtime.cl.cinematic.cinematicframe * 1000 / 14;
    return;
  }

  const realtime = options.currentTimeMs ?? runtime.cls.realtime;
  const frame = Math.trunc((realtime - runtime.cl.cinematic.cinematictime) * 14 / 1000);
  if (frame <= runtime.cl.cinematic.cinematicframe) {
    return;
  }

  if (frame > runtime.cl.cinematic.cinematicframe + 1) {
    runtime.cl.cinematic.cinematictime = realtime - runtime.cl.cinematic.cinematicframe * 1000 / 14;
  }

  runtime.cl.cinematic.pic = runtime.cl.cinematic.pic_pending;
  runtime.cl.cinematic.pic_pending = SCR_ReadNextFrame(runtime, hooks);
  if (!runtime.cl.cinematic.pic_pending) {
    SCR_StopCinematic(runtime, hooks);
    SCR_FinishCinematic(runtime);
    runtime.cl.cinematic.cinematictime = 1;
    screenBridge.SCR_BeginLoadingPlaque(runtime);
    runtime.cl.cinematic.cinematictime = 0;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (renderer raw cinematic adapter)
 * Category: Adapter
 * Adapts: SCR_DrawCinematic from client/cl_cin.c
 * Fidelity level: Close
 *
 * Behavior:
 * - Reports whether a cinematic is active and emits the current full-screen image draw command when available.
 *
 * Porting notes:
 * - Returns indexed-pixel snapshots so renderer adapters can upload static and streamed cinematic frames.
 */
export function SCR_DrawCinematic(
  runtime: ClientRuntime,
  options: {
    viewportWidth: number;
    viewportHeight: number;
    keyDest?: "game" | "console" | "message" | "menu";
  }
): { active: boolean; commands: HudDrawCommand[]; cinematic: ClientCinematicSnapshot | null } {
  if (runtime.cl.cinematic.cinematictime <= 0) {
    return { active: false, commands: [], cinematic: null };
  }

  if (options.keyDest === "menu") {
    runtime.cl.cinematic.cinematicpalette_active = false;
    return { active: true, commands: [], cinematic: null };
  }

  runtime.cl.cinematic.cinematicpalette_active = true;
  const cinematic = buildCinematicSnapshot(runtime);
  if (!cinematic) {
    return { active: true, commands: [], cinematic: null };
  }

  return {
    active: true,
    commands: cinematic.kind === "pcx-static" ? [{
      type: "picture",
      x: 0,
      y: 0,
      pic: runtime.cl.cinematic.name,
      bounds: {
        x: 0,
        y: 0,
        width: options.viewportWidth,
        height: options.viewportHeight
      }
    }] : [],
    cinematic
  };
}

/**
 * Original name: SCR_DrawCinematic
 * Source: client/cl_cin.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws the active cinematic frame through `refexport_t` using the original raw upload path.
 */
export function SCR_DrawCinematicRef(
  runtime: ClientRuntime,
  ref: refexport_t,
  options: {
    viewportWidth: number;
    viewportHeight: number;
    keyDest?: "game" | "console" | "message" | "menu";
  }
): boolean {
  if (runtime.cl.cinematic.cinematictime <= 0) {
    return false;
  }

  if (options.keyDest === "menu") {
    runtime.cl.cinematic.cinematicpalette_active = false;
    ref.CinematicSetPalette(null);
    return true;
  }

  runtime.cl.cinematic.cinematicpalette_active = true;
  if (!runtime.cl.cinematic.pic) {
    return true;
  }

  ref.CinematicSetPalette(runtime.cl.cinematic.cinematicpalette);
  ref.DrawStretchRaw(
    0,
    0,
    options.viewportWidth,
    options.viewportHeight,
    runtime.cl.cinematic.width,
    runtime.cl.cinematic.height,
    runtime.cl.cinematic.pic
  );
  return true;
}

/**
 * Original name: SCR_PlayCinematic
 * Source: client/cl_cin.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts one cinematic, covering the static `.pcx` and streamed `.cin` branches from the original code.
 *
 * Porting notes:
 * - Defers CD audio shutdown and sound subsystem restarts to host hooks.
 */
export function SCR_PlayCinematic(
  runtime: ClientRuntime,
  screenBridge: ClientCinematicScreenBridge,
  arg: string,
  hooks: ClientScreenHooks = {}
): boolean {
  SCR_StopCinematic(runtime, hooks);
  hooks.onCDAudioStop?.();
  runtime.cl.cinematic.cinematicframe = 0;

  if (arg.toLowerCase().endsWith(".pcx")) {
    const path = `pics/${arg}`;
    const bytes = hooks.loadBinaryFile?.(path) ?? null;
    screenBridge.SCR_EndLoadingPlaque(runtime);
    runtime.cls.state = connstate_t.ca_active;

    if (!bytes) {
      runtime.cl.cinematic.cinematictime = 0;
      return false;
    }

    const image = parsePcx(bytes, path);
    runtime.cl.cinematic.pic = image.indices;
    runtime.cl.cinematic.width = image.width;
    runtime.cl.cinematic.height = image.height;
    runtime.cl.cinematic.cinematicframe = -1;
    runtime.cl.cinematic.cinematictime = 1;
    runtime.cl.cinematic.kind = "pcx-static";
    runtime.cl.cinematic.name = path;
    runtime.cl.cinematic.cinematicpalette.set(image.paletteRgb);
    runtime.cl.cinematic.cinematicpalette_active = false;
    return true;
  }

  const path = `video/${arg}`;
  const bytes = hooks.loadBinaryFile?.(path) ?? null;
  if (!bytes) {
    SCR_FinishCinematic(runtime);
    runtime.cl.cinematic.cinematictime = 0;
    return false;
  }

  screenBridge.SCR_EndLoadingPlaque(runtime);
  runtime.cls.state = connstate_t.ca_active;
  runtime.cl.cinematic.file = bytes;
  runtime.cl.cinematic.file_position = 0;
  runtime.cl.cinematic.name = path;
  runtime.cl.cinematic.width = readCinematicLong(runtime);
  runtime.cl.cinematic.height = readCinematicLong(runtime);
  runtime.cl.cinematic.s_rate = readCinematicLong(runtime);
  runtime.cl.cinematic.s_width = readCinematicLong(runtime);
  runtime.cl.cinematic.s_channels = readCinematicLong(runtime);
  runtime.cl.cinematic.kind = "cinematic";

  if (runtime.cl.cinematic.width <= 0 || runtime.cl.cinematic.height <= 0) {
    SCR_StopCinematic(runtime, hooks);
    SCR_FinishCinematic(runtime);
    return false;
  }

  Huff1TableInit(runtime);
  const currentSoundKhz = hooks.getCurrentSoundKhz?.();
  const cinematicSoundKhz = Math.trunc(runtime.cl.cinematic.s_rate / 1000);
  if (currentSoundKhz !== undefined && currentSoundKhz !== cinematicSoundKhz) {
    runtime.cl.cinematic.restart_sound = true;
    hooks.onCinematicSoundRestart?.(cinematicSoundKhz);
  }

  runtime.cl.cinematic.cinematicframe = 0;
  runtime.cl.cinematic.pic = SCR_ReadNextFrame(runtime, hooks);
  if (!runtime.cl.cinematic.pic) {
    SCR_StopCinematic(runtime, hooks);
    SCR_FinishCinematic(runtime);
    return false;
  }

  runtime.cl.cinematic.pic_pending = null;
  runtime.cl.cinematic.cinematictime = Math.max(1, runtime.cls.realtime);
  return true;
}

/**
 * Original name: N/A
 * Source declaree: N/A (typed-array stream helper)
 * Category: New
 * Purpose: Read one little-endian 32-bit value from the loaded cinematic stream and advance the cursor.
 *
 * Constraints:
 * - Must fail loudly when the stream is truncated.
 */
function readCinematicLong(runtime: ClientRuntime): number {
  const bytes = runtime.cl.cinematic.file;
  if (!bytes || (runtime.cl.cinematic.file_position + 4) > bytes.length) {
    throw new Error("cinematic stream is truncated while reading one 32-bit field");
  }

  const offset = runtime.cl.cinematic.file_position;
  runtime.cl.cinematic.file_position += 4;
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  );
}

/**
 * Original name: N/A
 * Source declaree: N/A (typed-array stream helper)
 * Category: New
 * Purpose: Read one byte range from the loaded cinematic stream and advance the cursor.
 *
 * Constraints:
 * - Must preserve the original bytes exactly.
 */
function readCinematicBytes(runtime: ClientRuntime, length: number): Uint8Array | null {
  const bytes = runtime.cl.cinematic.file;
  if (!bytes || length < 0 || (runtime.cl.cinematic.file_position + length) > bytes.length) {
    return null;
  }

  const start = runtime.cl.cinematic.file_position;
  runtime.cl.cinematic.file_position += length;
  return bytes.slice(start, start + length);
}

/**
 * Original name: SmallestNode1
 * Source: client/cl_cin.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the smallest unused non-zero Huffman node and marks it used.
 */
function SmallestNode1(hUsed: Uint8Array, hCount: Int32Array, numhnodes: number): number {
  let best = 99999999;
  let bestnode = -1;

  for (let index = 0; index < numhnodes; index += 1) {
    if (hUsed[index] !== 0) {
      continue;
    }
    if (hCount[index] === 0) {
      continue;
    }
    if (hCount[index] < best) {
      best = hCount[index];
      bestnode = index;
    }
  }

  if (bestnode === -1) {
    return -1;
  }

  hUsed[bestnode] = 1;
  return bestnode;
}

/**
 * Original name: Huff1TableInit
 * Source: client/cl_cin.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads and builds the order-1 Huffman tables stored at the start of one Quake II cinematic stream.
 */
function Huff1TableInit(runtime: ClientRuntime): void {
  runtime.cl.cinematic.hnodes1 = new Int32Array(256 * 256 * 2);
  const hCount = new Int32Array(512);
  const hUsed = new Uint8Array(512);

  for (let prev = 0; prev < 256; prev += 1) {
    hCount.fill(0);
    hUsed.fill(0);

    const counts = readCinematicBytes(runtime, 256);
    if (!counts) {
      throw new Error("cinematic stream ended while reading Huffman tables");
    }

    for (let index = 0; index < 256; index += 1) {
      hCount[index] = counts[index];
    }

    let numhnodes = 256;
    const rowBase = prev * 256 * 2;

    while (numhnodes !== 511) {
      const left = SmallestNode1(hUsed, hCount, numhnodes);
      if (left === -1) {
        break;
      }

      const right = SmallestNode1(hUsed, hCount, numhnodes);
      if (right === -1) {
        break;
      }

      const nodeOffset = rowBase + (numhnodes - 256) * 2;
      runtime.cl.cinematic.hnodes1[nodeOffset] = left;
      runtime.cl.cinematic.hnodes1[nodeOffset + 1] = right;
      hCount[numhnodes] = hCount[left] + hCount[right];
      numhnodes += 1;
    }

    runtime.cl.cinematic.numhnodes1[prev] = numhnodes - 1;
  }
}

/**
 * Original name: Huff1Decompress
 * Source: client/cl_cin.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Decompresses one order-1 Huffman cinematic frame into indexed pixels.
 *
 * Porting notes:
 * - The original `cblock_t` is represented by the compressed input and returned `Uint8Array`.
 * - Replaces the original pointer arithmetic with explicit typed-array offsets.
 */
function Huff1Decompress(runtime: ClientRuntime, input: Uint8Array): Uint8Array {
  if (input.length < 4 || runtime.cl.cinematic.hnodes1 === null) {
    return new Uint8Array(0);
  }

  const count = (
    input[0]
    | (input[1] << 8)
    | (input[2] << 16)
    | (input[3] << 24)
  );
  const output = new Uint8Array(count);
  let inputOffset = 4;
  let outputOffset = 0;
  let rowBase = 0;
  let nodenum = runtime.cl.cinematic.numhnodes1[0];

  while (outputOffset < count && inputOffset < input.length) {
    let inbyte = input[inputOffset++];

    for (let bit = 0; bit < 8; bit += 1) {
      if (nodenum < 256) {
        output[outputOffset++] = nodenum;
        if (outputOffset >= count) {
          break;
        }
        rowBase = nodenum * 256 * 2;
        nodenum = runtime.cl.cinematic.numhnodes1[nodenum];
      }

      const nodeOffset = rowBase + (nodenum - 256) * 2 + (inbyte & 1);
      nodenum = runtime.cl.cinematic.hnodes1[nodeOffset];
      inbyte >>= 1;
    }
  }

  return output;
}

/**
 * Original name: SCR_ReadNextFrame
 * Source: client/cl_cin.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reads, decompresses and returns the next cinematic frame while forwarding its raw audio bytes.
 */
function SCR_ReadNextFrame(runtime: ClientRuntime, hooks: ClientScreenHooks = {}): Uint8Array | null {
  if (!runtime.cl.cinematic.file) {
    return null;
  }

  let command: number;
  try {
    command = readCinematicLong(runtime);
  } catch {
    return null;
  }

  if (command === 2) {
    return null;
  }

  if (command === 1) {
    const palette = readCinematicBytes(runtime, runtime.cl.cinematic.cinematicpalette.length);
    if (!palette) {
      return null;
    }
    runtime.cl.cinematic.cinematicpalette.set(palette);
    runtime.cl.cinematic.cinematicpalette_active = false;
  }

  const size = readCinematicLong(runtime);
  if (size < 1 || size > 0x20000) {
    throw new Error(`bad compressed cinematic frame size: ${size}`);
  }

  const compressed = readCinematicBytes(runtime, size);
  if (!compressed) {
    return null;
  }

  const start = Math.trunc(runtime.cl.cinematic.cinematicframe * runtime.cl.cinematic.s_rate / 14);
  const end = Math.trunc((runtime.cl.cinematic.cinematicframe + 1) * runtime.cl.cinematic.s_rate / 14);
  const count = end - start;
  const sampleBytes = count * runtime.cl.cinematic.s_width * runtime.cl.cinematic.s_channels;
  const samples = readCinematicBytes(runtime, sampleBytes);
  if (!samples) {
    return null;
  }

  hooks.onCinematicRawSamples?.(
    count,
    runtime.cl.cinematic.s_rate,
    runtime.cl.cinematic.s_width,
    runtime.cl.cinematic.s_channels,
    samples
  );

  const pic = Huff1Decompress(runtime, compressed);
  runtime.cl.cinematic.cinematicframe += 1;
  return pic;
}

/**
 * Original name: N/A
 * Source declaree: N/A (renderer snapshot adapter)
 * Category: New
 * Purpose: Build a renderer-neutral snapshot for the current cinematic frame.
 *
 * Constraints:
 * - Must preserve indexed pixels and palette bytes exactly.
 */
function buildCinematicSnapshot(runtime: ClientRuntime): ClientCinematicSnapshot | null {
  if (!runtime.cl.cinematic.pic) {
    return null;
  }

  return {
    kind: runtime.cl.cinematic.kind === "pcx-static" ? "pcx-static" : "cinematic",
    name: runtime.cl.cinematic.name,
    width: runtime.cl.cinematic.width,
    height: runtime.cl.cinematic.height,
    pixels: runtime.cl.cinematic.pic,
    paletteRgb: runtime.cl.cinematic.cinematicpalette.slice()
  };
}
