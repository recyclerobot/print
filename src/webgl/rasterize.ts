import type { AnyElement, TextElement, ImageElement, RectElement } from '../types';
import { mmToPx } from '../units';

// Rasterize a single element to an offscreen 2D canvas at the given pixels-per-mm.
// Returns a canvas sized to the element's bounding box (without rotation).
export function rasterizeElement(el: AnyElement, pxPerMm: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(el.width * pxPerMm));
  const h = Math.max(1, Math.round(el.height * pxPerMm));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  switch (el.type) {
    case 'rect': drawRect(ctx, el, w, h, pxPerMm); break;
    case 'text': drawText(ctx, el, w, h, pxPerMm); break;
    case 'image': /* drawn via separate path with image bitmap */ break;
  }
  return canvas;
}

function drawRect(ctx: CanvasRenderingContext2D, el: RectElement, w: number, h: number, pxPerMm: number): void {
  const r = Math.max(0, el.cornerRadius * pxPerMm);
  const sw = Math.max(0, el.strokeWidth * pxPerMm);
  const inset = sw / 2;
  ctx.beginPath();
  roundRect(ctx, inset, inset, w - sw, h - sw, r);
  if (el.fill && el.fill !== 'transparent') {
    ctx.fillStyle = el.fill;
    ctx.fill();
  }
  if (sw > 0) {
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = sw;
    ctx.stroke();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawText(ctx: CanvasRenderingContext2D, el: TextElement, w: number, h: number, pxPerMm: number): void {
  const fontSizePx = mmToPx(el.fontSize / 72 * 25.4, 96 * (pxPerMm / mmToPx(1, 96)));
  // Simpler: pt -> px at 72dpi base, then scale by render scale.
  // 1pt = 1/72in = 25.4/72 mm. So fontSizeMm = el.fontSize * 25.4/72.
  const fontMm = el.fontSize * 25.4 / 72;
  const sizePx = fontMm * pxPerMm;
  const style = `${el.italic ? 'italic ' : ''}${el.fontWeight} ${sizePx}px ${el.fontFamily}`;
  ctx.font = style;
  ctx.fillStyle = el.color;
  ctx.textBaseline = 'alphabetic';

  const lineHeight = sizePx * el.lineHeight;
  const lines = wrapText(ctx, el.text, w, el.letterSpacing, sizePx);

  let y = 0;
  switch (el.vAlign) {
    case 'top': y = lineHeight; break;
    case 'middle': y = (h - lines.length * lineHeight) / 2 + lineHeight * 0.8; break;
    case 'bottom': y = h - (lines.length - 1) * lineHeight - lineHeight * 0.2; break;
  }

  for (const line of lines) {
    drawLine(ctx, line, w, y, el, sizePx);
    y += lineHeight;
  }
  void fontSizePx;
}

function measureWithSpacing(ctx: CanvasRenderingContext2D, text: string, letterSpacingEm: number, sizePx: number): number {
  if (!letterSpacingEm) return ctx.measureText(text).width;
  let total = 0;
  for (const ch of text) {
    total += ctx.measureText(ch).width + letterSpacingEm * sizePx;
  }
  return total - letterSpacingEm * sizePx;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, letterSpacing: number, sizePx: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      const trial = line + word;
      if (measureWithSpacing(ctx, trial, letterSpacing, sizePx) > maxWidth && line.trim().length) {
        out.push(line.replace(/\s+$/, ''));
        line = word.replace(/^\s+/, '');
      } else {
        line = trial;
      }
    }
    out.push(line);
  }
  return out;
}

function drawLine(ctx: CanvasRenderingContext2D, line: string, maxWidth: number, y: number, el: TextElement, sizePx: number): void {
  const lineWidth = measureWithSpacing(ctx, line, el.letterSpacing, sizePx);
  let x = 0;
  switch (el.align) {
    case 'left': x = 0; break;
    case 'center': x = (maxWidth - lineWidth) / 2; break;
    case 'right': x = maxWidth - lineWidth; break;
    case 'justify': {
      // Justify by distributing extra space between words.
      const words = line.split(/\s+/).filter(Boolean);
      if (words.length > 1) {
        const wordsWidth = words.reduce((a, w) => a + measureWithSpacing(ctx, w, el.letterSpacing, sizePx), 0);
        const gap = (maxWidth - wordsWidth) / (words.length - 1);
        let cx = 0;
        for (const w of words) {
          drawCharSpaced(ctx, w, cx, y, el.letterSpacing, sizePx);
          cx += measureWithSpacing(ctx, w, el.letterSpacing, sizePx) + gap;
        }
        return;
      }
      x = 0;
    }
  }
  drawCharSpaced(ctx, line, x, y, el.letterSpacing, sizePx);
}

function drawCharSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, letterSpacingEm: number, sizePx: number): void {
  if (!letterSpacingEm) {
    ctx.fillText(text, x, y);
    return;
  }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + letterSpacingEm * sizePx;
  }
}

// Image cache: src -> HTMLImageElement (loaded)
const imageCache = new Map<string, HTMLImageElement>();
const pendingImages = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return Promise.resolve(cached);
  const pending = pendingImages.get(src);
  if (pending) return pending;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => { imageCache.set(src, img); pendingImages.delete(src); resolve(img); };
    img.onerror = (e) => { pendingImages.delete(src); reject(e); };
    img.src = src;
  });
  pendingImages.set(src, p);
  return p;
}

export function getCachedImage(src: string): HTMLImageElement | undefined {
  return imageCache.get(src);
}

export function rasterizeImage(el: ImageElement, img: HTMLImageElement, pxPerMm: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(el.width * pxPerMm));
  const h = Math.max(1, Math.round(el.height * pxPerMm));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return canvas;
  let dx = 0, dy = 0, dw = w, dh = h;
  if (el.fit === 'contain') {
    const s = Math.min(w / iw, h / ih);
    dw = iw * s; dh = ih * s;
    dx = (w - dw) / 2; dy = (h - dh) / 2;
  } else if (el.fit === 'cover') {
    const s = Math.max(w / iw, h / ih);
    dw = iw * s; dh = ih * s;
    dx = (w - dw) / 2; dy = (h - dh) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  return canvas;
}
