import { playerColors } from "./playerColors";

export type Write = (height: number, base64String: string) => string;
export type WriteScore = (height: number, score: number, shirt: number, pant: number) => string;
export type Writer = {write: Write; writeScore: WriteScore};

let staticCharmap: Promise<Writer> | null = null
export const createWriter = (): Promise<Writer> => {
  const canvas = document.createElement('CANVAS') as HTMLCanvasElement;
  if (!staticCharmap) {
    staticCharmap = new Promise((resolve, reject) => {
      var img = new Image();
      img.onload = function () {
        resolve({
          writeScore: writeScore(canvas, img),
          write: write(canvas, img),
        });
      };
      // Error, not the raw Event — see assetStore/errorReporting: an Event reports as {"isTrusted":true}.
      img.onerror = () => reject(new Error('failed to load charset-6.png'));
      img.src = `${import.meta.env.BASE_URL}img/charset-6.png`;
    });
  }
  return staticCharmap
};

const writeToCanvas = (
  charmap: HTMLImageElement,
  ctx: CanvasRenderingContext2D,
  height: number,
  stringToWrite: string,
) => {
  ctx.fillStyle = 'transparent';
  ctx.fillRect(0, 0, 300, 300);
  // Characters across
  const hCh = 16;
  // Characters vertical
  const vCh = 16;

  const heightOfChars = height || 16;

  const origCharPxWidth = charmap.width / hCh;
  const origCharPxHeight = charmap.height / vCh;

  const scale = heightOfChars / origCharPxHeight;

  const hPx = heightOfChars;
  const wPx = scale * origCharPxWidth;

  const nameLength = stringToWrite.length;
  let lineNum = 0
  let linePos = 0
  let maxLength = 0
  for (let i = 0; i < nameLength; i++) {
    const nameChar = stringToWrite.charCodeAt(i);
    if (linePos > maxLength) {
      maxLength = linePos
    }
    if (nameChar === 10) {
      lineNum++
      linePos = 0
      continue
    }

    const vCharOffset = nameChar >> 4; // eslint-disable-line
    const hCharOffset = nameChar & 0x0f; // eslint-disable-line

    //ctx.drawImage(charmap, sx, sy, sw, sh, dx, dy, dw, dh)
    ctx.drawImage(
      charmap,
      hCharOffset * origCharPxWidth,
      vCharOffset * origCharPxHeight,
      origCharPxWidth,
      origCharPxHeight,
      linePos * wPx,
      lineNum * hPx,
      wPx,
      hPx,
    );
    linePos++
  }

  return {
    width: maxLength * wPx,
    height,
  };
};

const writeScore = (canvas: HTMLCanvasElement, charmap: HTMLImageElement) => (
  height: number,
  score: number,
  shirt: number,
  pant: number,
) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }
  const width = 60;

  ctx.canvas.width = width;
  ctx.canvas.height = height;

  const halfHeight = height / 2;
  ctx.fillStyle = playerColors[shirt];
  ctx.fillRect(0, 0, width, halfHeight);
  ctx.fillStyle = playerColors[pant];
  ctx.fillRect(0, halfHeight, width, halfHeight);
  const strScore = score.toString();

  ctx.translate(width - strScore.length * height - 5, 0);
  writeToCanvas(charmap, ctx, height, strScore);
  ctx.restore();

  return canvas.toDataURL('image/png');
};

const write = (canvas: HTMLCanvasElement, charmap: HTMLImageElement) => (height: number, base64String: string) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }
  const strToWrite = atob(base64String) || ' ';
  const lines = strToWrite.split('\n')
  const maxLine = lines.reduce((len, line) => len > line.length ? len : line.length, 0)
  ctx.canvas.width = maxLine * height;
  ctx.canvas.height = lines.length   * height;

  writeToCanvas(charmap, ctx, height, strToWrite);

  return canvas.toDataURL('image/png');
  //Make background transparent
  //$chars->paintTransparentImage($chars->getImagePixelColor(0,0),0.0,0);
};
