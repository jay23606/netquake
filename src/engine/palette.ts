export var d_8to24table = new Uint32Array(new ArrayBuffer(1024))
export var d_8to24table_fbright = new Uint32Array(new ArrayBuffer(1024))
export var d_8to24table_fbright_fence = new Uint32Array(new ArrayBuffer(1024))
export var d_8to24table_nobright = new Uint32Array(new ArrayBuffer(1024))
export var d_8to24table_nobright_fence = new Uint32Array(new ArrayBuffer(1024))
export var d_8to24table_conchars = new Uint32Array(new ArrayBuffer(1024))
export var d_8to24table_shirt = new Uint32Array(new ArrayBuffer(1024))
export var d_8to24table_pants = new Uint32Array(new ArrayBuffer(1024))
// alias skins: full RGB, but fullbright indices (224-255) carry alpha 0 -- the alias
// shader uses texture.a as its lighting mix factor, so those texels render unlit.
export var d_8to24table_skin = new Uint32Array(new ArrayBuffer(1024))
import * as com from './com'
import * as sys from './sys'

const loadPalette = async () => {
	var palette = await com.loadFile('gfx/palette.lmp');
	if (palette == null)
		sys.error('Couldn\'t load gfx/palette.lmp');
	return new Uint8Array(palette);
}

export const setPalette = async () => {
	var pal = await loadPalette()
  var src = 0, i = 0
  
	for (i = 0; i < 255; ++i) {
		d_8to24table[i] = d_8to24table_conchars[i] = pal[src] + (pal[src + 1] << 8) + (pal[src + 2] << 16)
		d_8to24table[i] += 0xFF000000
		src += 3
	}
	d_8to24table[255] = pal[src] + (pal[src + 1] << 8) + (pal[src + 2] << 16)

	//fullbright palette, 0-223 are black (for additive blending)
	for (i = 0; i < 224; ++i) {
		d_8to24table_fbright[i] = d_8to24table_fbright_fence[i] = 0xff000000
	}
	var src = 224 * 3
	for (i = 224; i < 256; i++) {
		d_8to24table_fbright[i] = d_8to24table_fbright_fence[i] =  pal[src] + (pal[src + 1] << 8) + (pal[src + 2] << 16) + 0xff000000
		src += 3
	}
	d_8to24table_fbright_fence[255] = 0

	//skin palette: full colors, alpha 0 marks fullbrights for the alias shader mix
	var src = 0
	for (i = 0; i < 256; ++i) {
		d_8to24table_skin[i] = pal[src] + (pal[src + 1] << 8) + (pal[src + 2] << 16) + (i < 224 ? 0xff000000 : 0)
		src += 3
	}

	//nobright palette, 224-255 are black (for additive blending)
	var src = 0
	for (i = 0; i < 224; ++i) {
		d_8to24table_nobright[i] = d_8to24table_nobright_fence[i] = pal[src] + (pal[src + 1] << 8) + (pal[src + 2] << 16) + 0xff000000
		src += 3
	}
	for (i = 224; i < 256; i++) {
		d_8to24table_nobright[i] = d_8to24table_nobright_fence[i] = 0xff000000
	}
	d_8to24table_nobright_fence[255] = 0
}