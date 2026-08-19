// Cold-path image decoders for external skybox/texture assets (TGA/PCX/PNG/JPG).
// No GL code, no per-frame concerns — everything here runs at load time.
import * as con from './console'
import * as com from './com'

export type RGBAImage = { width: number, height: number, data: Uint8Array } // RGBA, row 0 = top

const TGA_HEADER_SIZE = 18

// reads one source pixel at `pos` into `out` at `outOff` as RGBA; returns bytes consumed
const readTgaPixel = (view: DataView, pos: number, bytesPerPixel: number, grey: boolean, out: Uint8Array, outOff: number): number => {
  if (grey) {
    const v = view.getUint8(pos)
    out[outOff] = v; out[outOff + 1] = v; out[outOff + 2] = v; out[outOff + 3] = 255
    return 1
  }
  if (bytesPerPixel === 2) {
    // 16bpp: A1R5G5B5
    const v = view.getUint16(pos, true)
    const r5 = (v >> 10) & 0x1f, g5 = (v >> 5) & 0x1f, b5 = v & 0x1f
    out[outOff] = (r5 << 3) | (r5 >> 2)
    out[outOff + 1] = (g5 << 3) | (g5 >> 2)
    out[outOff + 2] = (b5 << 3) | (b5 >> 2)
    out[outOff + 3] = 255
    return 2
  }
  // 24/32bpp source is stored BGR(A)
  out[outOff] = view.getUint8(pos + 2)
  out[outOff + 1] = view.getUint8(pos + 1)
  out[outOff + 2] = view.getUint8(pos)
  out[outOff + 3] = bytesPerPixel === 4 ? view.getUint8(pos + 3) : 255
  return bytesPerPixel
}

// TGA types 2/10 (truecolor) and 3/11 (greyscale), 16/24/32bpp. Paletted (1/9) unsupported.
// Output is always top-down regardless of the file's origin attribute bit.
export const decodeTGA = (buf: ArrayBuffer): RGBAImage | null => {
  if (buf.byteLength < TGA_HEADER_SIZE) return null
  const view = new DataView(buf)
  const idLength = view.getUint8(0)
  const imageType = view.getUint8(2)
  const width = view.getUint16(12, true)
  const height = view.getUint16(14, true)
  const pixelSize = view.getUint8(16)
  const attributes = view.getUint8(17)

  if (imageType === 1 || imageType === 9) {
    con.print('image: paletted TGA not supported\n')
    return null
  }
  if (imageType !== 2 && imageType !== 3 && imageType !== 10 && imageType !== 11) {
    con.print(`image: unsupported TGA type ${imageType}\n`)
    return null
  }
  if (width <= 0 || height <= 0) return null

  const grey = imageType === 3 || imageType === 11
  const rle = imageType === 10 || imageType === 11
  const bytesPerPixel = pixelSize / 8
  if (grey ? bytesPerPixel !== 1 : (bytesPerPixel !== 2 && bytesPerPixel !== 3 && bytesPerPixel !== 4)) {
    con.print(`image: unsupported TGA pixel size ${pixelSize}\n`)
    return null
  }

  const topDown = (attributes & 0x20) !== 0 // bit5 set = origin already top-left
  const totalPixels = width * height
  const data = new Uint8Array(totalPixels * 4)

  try {
    let pos = TGA_HEADER_SIZE + idLength
    let pixelIndex = 0
    if (!rle) {
      for (; pixelIndex < totalPixels; pixelIndex++) {
        const fileRow = (pixelIndex / width) | 0
        const fileCol = pixelIndex % width
        const outRow = topDown ? fileRow : height - 1 - fileRow
        pos += readTgaPixel(view, pos, bytesPerPixel, grey, data, (outRow * width + fileCol) * 4)
      }
    } else {
      const tmp = new Uint8Array(4)
      while (pixelIndex < totalPixels) {
        const packetHeader = view.getUint8(pos); pos += 1
        const count = (packetHeader & 0x7f) + 1
        if (packetHeader & 0x80) {
          // run-length packet: one pixel value repeated `count` times
          pos += readTgaPixel(view, pos, bytesPerPixel, grey, tmp, 0)
          for (let k = 0; k < count && pixelIndex < totalPixels; k++, pixelIndex++) {
            const fileRow = (pixelIndex / width) | 0
            const fileCol = pixelIndex % width
            const outRow = topDown ? fileRow : height - 1 - fileRow
            const outOff = (outRow * width + fileCol) * 4
            data[outOff] = tmp[0]; data[outOff + 1] = tmp[1]; data[outOff + 2] = tmp[2]; data[outOff + 3] = tmp[3]
          }
        } else {
          // raw packet: `count` distinct pixel values follow
          for (let k = 0; k < count && pixelIndex < totalPixels; k++, pixelIndex++) {
            const fileRow = (pixelIndex / width) | 0
            const fileCol = pixelIndex % width
            const outRow = topDown ? fileRow : height - 1 - fileRow
            pos += readTgaPixel(view, pos, bytesPerPixel, grey, data, (outRow * width + fileCol) * 4)
          }
        }
      }
    }
  } catch (e) {
    con.print('image: truncated TGA\n')
    return null
  }

  return { width, height, data }
}

const PCX_HEADER_SIZE = 128
const PCX_PALETTE_SIZE = 768

// Standard Quake PCX: 8bpp RLE-encoded, 768-byte palette trailing the file.
export const decodePCX = (buf: ArrayBuffer): RGBAImage | null => {
  if (buf.byteLength < PCX_HEADER_SIZE + PCX_PALETTE_SIZE) return null
  const view = new DataView(buf)
  const manufacturer = view.getUint8(0)
  const version = view.getUint8(1)
  const encoding = view.getUint8(2)
  const bitsPerPixel = view.getUint8(3)
  const xmin = view.getUint16(4, true)
  const ymin = view.getUint16(6, true)
  const xmax = view.getUint16(8, true)
  const ymax = view.getUint16(10, true)
  const colorPlanes = view.getUint8(65)
  const bytesPerLine = view.getUint16(66, true)

  if (manufacturer !== 0x0a) {
    con.print('image: not a PCX file\n')
    return null
  }
  if (version !== 5 || encoding !== 1 || bitsPerPixel !== 8 || colorPlanes !== 1) {
    con.print('image: unsupported PCX encoding/depth\n')
    return null
  }

  const width = xmax - xmin + 1
  const height = ymax - ymin + 1
  if (width <= 0 || height <= 0) return null

  const bytes = new Uint8Array(buf)
  const palette = new Uint8Array(buf, buf.byteLength - PCX_PALETTE_SIZE, PCX_PALETTE_SIZE)
  const data = new Uint8Array(width * height * 4)

  try {
    let pos = PCX_HEADER_SIZE
    for (let y = 0; y < height; y++) {
      const rowOff = y * width * 4
      for (let x = 0; x < bytesPerLine;) {
        let readByte = bytes[pos]
        if (readByte === undefined) throw new Error('eof')
        pos++
        let runLength = 1
        if (readByte >= 0xc0) {
          runLength = readByte & 0x3f
          readByte = bytes[pos]
          if (readByte === undefined) throw new Error('eof')
          pos++
        }
        while (runLength--) {
          if (x < width) { // bytesPerLine may include a padding byte past width
            const o = rowOff + x * 4
            data[o] = palette[readByte * 3]
            data[o + 1] = palette[readByte * 3 + 1]
            data[o + 2] = palette[readByte * 3 + 2]
            data[o + 3] = 255
          }
          x++
        }
      }
    }
  } catch (e) {
    con.print('image: truncated PCX\n')
    return null
  }

  return { width, height, data }
}

// PNG/JPG: decode via the browser and read back through a canvas so the result matches
// the same top-down RGBA shape as the TGA/PCX decoders.
const decodeRaster = async (buf: ArrayBuffer): Promise<RGBAImage | null> => {
  try {
    const bitmap = await createImageBitmap(new Blob([buf]))
    const width = bitmap.width, height = bitmap.height
    let imageData: ImageData
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0)
      imageData = ctx.getImageData(0, 0, width, height)
    } else {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0)
      imageData = ctx.getImageData(0, 0, width, height)
    }
    bitmap.close()
    return { width, height, data: new Uint8Array(imageData.data) }
  } catch (e) {
    con.print(`image: failed to decode raster image (${e})\n`)
    return null
  }
}

// gfx-style extension fallback (Ironwail image.c:112-158); tga tried first since virtually
// all Quake skyboxes are tga and each miss is an asset-store roundtrip. `name` has no extension.
export const loadImage = async (name: string): Promise<RGBAImage | null> => {
  const exts = ['tga', 'png', 'jpg', 'pcx']
  for (const ext of exts) {
    const buf = await com.loadFile(`${name}.${ext}`)
    if (buf == null) continue
    if (ext === 'tga') return decodeTGA(buf)
    if (ext === 'pcx') return decodePCX(buf)
    return await decodeRaster(buf)
  }
  return null
}
