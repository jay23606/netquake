// Convert a Quake extended ASCII string to HTML with color spans.
//
// Quake character encoding:
//   0-31:    Special glyphs (map to closest printable chars or skip)
//   32-127:  Standard ASCII, default text color
//   128-159: Same as 0-31 but alternate (gold) color
//   160-255: Same as 32-127 but alternate (gold) color
//
// The high bit (& 0x80) signals the gold/bronze color variant.

const specialChars: Record<number, string> = {
  // Map Quake's 0-31 special characters to closest Unicode equivalents
  0: ' ', 1: ' ', 2: ' ', 3: ' ', 4: ' ', 5: '•', 6: ' ', 7: ' ',
  8: ' ', 9: ' ', 10: ' ', 11: ' ', 12: ' ', 13: '>', 14: '•', 15: '•',
  16: '[', 17: ']', 18: '0', 19: '1', 20: '2', 21: '3', 22: '4', 23: '5',
  24: '6', 25: '7', 26: '8', 27: '9', 28: '•', 29: '<', 30: '-', 31: '>',
}

const escapeHtml = (c: string): string => {
  if (c === '<') return '&lt;'
  if (c === '>') return '&gt;'
  if (c === '&') return '&amp;'
  if (c === '"') return '&quot;'
  return c
}

/**
 * Convert a Quake string to HTML with gold-colored spans for extended characters.
 * Returns an HTML string safe for use with v-html.
 */
export const quakeTextToHtml = (text: string): string => {
  let html = ''
  let currentClass: string | null = null

  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i)
    const highBit = code >= 128

    if (highBit) code -= 128

    // Characters 0-31 are Quake's gold glyphs (brackets, numbers, dots, arrows)
    const isGoldGlyph = code < 32
    const charClass = isGoldGlyph ? 'q-gold' : highBit ? 'q-brown' : null

    const char = code < 32
      ? specialChars[code] || ' '
      : String.fromCharCode(code)

    if (charClass !== currentClass) {
      if (currentClass) html += '</span>'
      if (charClass) html += `<span class="${charClass}">`
      currentClass = charClass
    }

    html += escapeHtml(char)
  }

  if (currentClass) html += '</span>'
  return html
}

/**
 * Convert a Quake string to plain text (strip extended encoding).
 */
export const quakeTextToPlain = (text: string): string => {
  let result = ''
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i)
    if (code >= 128) code -= 128
    result += code < 32
      ? specialChars[code] || ' '
      : String.fromCharCode(code)
  }
  return result
}
