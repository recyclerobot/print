import type { PrintDocument, Page, AnyElement, TextElement, ImageElement, RectElement } from './types';
import { mmToPx } from './units';
import { loadImage } from './webgl/rasterize';

// Render a page to an existing canvas at the given DPI for screen preview.
// Mirrors the PDF export logic but draws to an arbitrary canvas (no bleed/crop).
export async function exportPagePreview(doc: PrintDocument, page: Page, canvas: HTMLCanvasElement, dpi: number): Promise<void> {
  const pxPerMm = dpi / 25.4;
  const W = Math.round(mmToPx(doc.size.width, dpi));
  const H = Math.round(mmToPx(doc.size.height, dpi));
  canvas.width = W; canvas.height = H;
  // Display size: scale down so it fits the preview window comfortably.
  const screenScale = Math.min(1, 800 / W);
  canvas.style.width = `${Math.round(W * screenScale)}px`;
  canvas.style.height = `${Math.round(H * screenScale)}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = page.background || '#ffffff';
  ctx.fillRect(0, 0, W, H);
  for (const el of page.elements) {
    if (el.hidden) continue;
    await drawElement(ctx, el, pxPerMm);
  }
}

async function drawElement(ctx: CanvasRenderingContext2D, el: AnyElement, pxPerMm: number): Promise<void> {
  ctx.save();
  ctx.globalAlpha = el.opacity;
  const cx = (el.x + el.width / 2) * pxPerMm;
  const cy = (el.y + el.height / 2) * pxPerMm;
  ctx.translate(cx, cy);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  if (el.type === 'rect') drawRect(ctx, el, pxPerMm);
  else if (el.type === 'text') drawText(ctx, el, pxPerMm);
  else if (el.type === 'image') await drawImage(ctx, el, pxPerMm);
  ctx.restore();
}

function drawRect(ctx: CanvasRenderingContext2D, el: RectElement, pxPerMm: number): void {
  const x = el.x * pxPerMm, y = el.y * pxPerMm;
  const w = el.width * pxPerMm, h = el.height * pxPerMm;
  const r = Math.max(0, el.cornerRadius * pxPerMm);
  const sw = Math.max(0, el.strokeWidth * pxPerMm);
  ctx.beginPath();
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
  if (el.fill) { ctx.fillStyle = el.fill; ctx.fill(); }
  if (sw > 0) { ctx.strokeStyle = el.stroke; ctx.lineWidth = sw; ctx.stroke(); }
}

function drawText(ctx: CanvasRenderingContext2D, el: TextElement, pxPerMm: number): void {
  const x = el.x * pxPerMm, y = el.y * pxPerMm;
  const w = el.width * pxPerMm, h = el.height * pxPerMm;
  const sizePx = (el.fontSize * 25.4 / 72) * pxPerMm;
  ctx.save(); ctx.translate(x, y);
  ctx.font = `${el.italic ? 'italic ' : ''}${el.fontWeight} ${sizePx}px ${el.fontFamily}`;
  ctx.fillStyle = el.color; ctx.textBaseline = 'alphabetic';
  const lines: string[] = [];
  for (const para of el.text.split(/\n/)) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const wd of words) {
      const trial = line + wd;
      if (ctx.measureText(trial).width > w && line.trim().length) { lines.push(line); line = wd.replace(/^\s+/, ''); }
      else line = trial;
    }
    lines.push(line);
  }
  const lh = sizePx * el.lineHeight;
  let cy = lh;
  if (el.vAlign === 'middle') cy = (h - lines.length * lh) / 2 + lh * 0.8;
  if (el.vAlign === 'bottom') cy = h - (lines.length - 1) * lh - lh * 0.2;
  for (const line of lines) {
    let lx = 0;
    const lw = ctx.measureText(line).width;
    if (el.align === 'center') lx = (w - lw) / 2;
    else if (el.align === 'right') lx = w - lw;
    ctx.fillText(line, lx, cy);
    cy += lh;
  }
  ctx.restore();
}

async function drawImage(ctx: CanvasRenderingContext2D, el: ImageElement, pxPerMm: number): Promise<void> {
  let img: HTMLImageElement;
  try { img = await loadImage(el.src); } catch { return; }
  const x = el.x * pxPerMm, y = el.y * pxPerMm;
  const w = el.width * pxPerMm, h = el.height * pxPerMm;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;
  let dx = x, dy = y, dw = w, dh = h;
  if (el.fit === 'contain') {
    const s = Math.min(w / iw, h / ih);
    dw = iw * s; dh = ih * s;
    dx = x + (w - dw) / 2; dy = y + (h - dh) / 2;
  } else if (el.fit === 'cover') {
    const s = Math.max(w / iw, h / ih);
    dw = iw * s; dh = ih * s;
    dx = x + (w - dw) / 2; dy = y + (h - dh) / 2;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh); ctx.restore();
    return;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}
