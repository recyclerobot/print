import { jsPDF } from "jspdf";
import type {
  PrintDocument,
  Page,
  AnyElement,
  TextElement,
  RectElement,
  ImageElement,
} from "./types";
import { mmToPx } from "./units";
import { loadImage } from "./webgl/rasterize";

export type ExportDpi = 72 | 150 | 300 | 600 | 1200;

export type ExportSizeMode = "bruto" | "netto";
export type ExportImageFormat = "jpeg" | "png";

export interface ExportOptions {
  dpi: ExportDpi;
  /**
   * "bruto" = trim + bleed (bleedbox). "netto" = trim only (final cut size).
   * Replaces the older includeBleed flag.
   */
  sizeMode: ExportSizeMode;
  /** Draw printers' crop marks at the four corners of the trim box. */
  cropMarks: boolean;
  /** Draw registration marks (target circles) on each side. */
  registrationMarks: boolean;
  /** Output image codec inside the PDF. PNG = lossless, larger files. */
  imageFormat: ExportImageFormat;
  /** JPEG quality 0..1, ignored for PNG. */
  jpegQuality: number;
  /** Background color for the bleed/page surface. */
  background: string;
  /** 1-based page numbers; undefined = all pages. */
  pages?: number[];
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  dpi: 300,
  sizeMode: "bruto",
  cropMarks: true,
  registrationMarks: false,
  imageFormat: "jpeg",
  jpegQuality: 0.92,
  background: "#ffffff",
};

export async function exportPdf(
  doc: PrintDocument,
  opts: ExportOptions,
): Promise<Blob> {
  const includeBleed = opts.sizeMode === "bruto";
  const bleed = includeBleed
    ? doc.bleed
    : { top: 0, right: 0, bottom: 0, left: 0 };
  const pageWmm = doc.size.width + bleed.left + bleed.right;
  const pageHmm = doc.size.height + bleed.top + bleed.bottom;

  const pdf = new jsPDF({
    orientation: pageWmm > pageHmm ? "landscape" : "portrait",
    unit: "mm",
    format: [pageWmm, pageHmm],
    compress: true,
  });

  const indices = (
    opts.pages?.length
      ? opts.pages.map((n) => n - 1)
      : doc.pages.map((_, i) => i)
  ).filter((i) => i >= 0 && i < doc.pages.length);

  for (let i = 0; i < indices.length; i++) {
    const page = doc.pages[indices[i]];
    if (!page) continue;
    if (i > 0)
      pdf.addPage(
        [pageWmm, pageHmm],
        pageWmm > pageHmm ? "landscape" : "portrait",
      );
    const dataUrl = await rasterizePageToDataUrl(doc, page, opts);
    const fmt = opts.imageFormat === "png" ? "PNG" : "JPEG";
    pdf.addImage(dataUrl, fmt, 0, 0, pageWmm, pageHmm, undefined, "FAST");
  }
  return pdf.output("blob");
}

async function rasterizePageToDataUrl(
  doc: PrintDocument,
  page: Page,
  opts: ExportOptions,
): Promise<string> {
  const dpi = opts.dpi;
  const includeBleed = opts.sizeMode === "bruto";
  const bleed = includeBleed
    ? doc.bleed
    : { top: 0, right: 0, bottom: 0, left: 0 };
  const pageWmm = doc.size.width + bleed.left + bleed.right;
  const pageHmm = doc.size.height + bleed.top + bleed.bottom;
  const pxPerMm = dpi / 25.4;
  const W = Math.round(mmToPx(pageWmm, dpi));
  const H = Math.round(mmToPx(pageHmm, dpi));

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  // Fill page surface (bleed area + page area). Page background still wins
  // over this for the trimbox area.
  ctx.fillStyle = opts.background || "#ffffff";
  ctx.fillRect(0, 0, W, H);
  if (includeBleed) {
    ctx.fillStyle = page.background || "#ffffff";
    ctx.fillRect(
      bleed.left * pxPerMm,
      bleed.top * pxPerMm,
      doc.size.width * pxPerMm,
      doc.size.height * pxPerMm,
    );
  } else {
    ctx.fillStyle = page.background || "#ffffff";
    ctx.fillRect(0, 0, W, H);
  }

  // Translate so that (0,0) corresponds to page top-left (inside bleed region).
  ctx.save();
  ctx.translate(bleed.left * pxPerMm, bleed.top * pxPerMm);

  for (const el of page.elements) {
    if (el.hidden) continue;
    await drawElementToContext(ctx, el, pxPerMm);
  }
  ctx.restore();

  if (opts.cropMarks && includeBleed) {
    drawCropMarks(ctx, doc, pxPerMm, bleed);
  }
  if (opts.registrationMarks && includeBleed) {
    drawRegistrationMarks(ctx, doc, pxPerMm, bleed);
  }

  if (opts.imageFormat === "png") {
    return canvas.toDataURL("image/png");
  }
  const quality = Math.max(0.1, Math.min(1, opts.jpegQuality));
  return canvas.toDataURL("image/jpeg", quality);
}

async function drawElementToContext(
  ctx: CanvasRenderingContext2D,
  el: AnyElement,
  pxPerMm: number,
): Promise<void> {
  ctx.save();
  ctx.globalAlpha = el.opacity;
  // Rotate around element center
  const cx = (el.x + el.width / 2) * pxPerMm;
  const cy = (el.y + el.height / 2) * pxPerMm;
  ctx.translate(cx, cy);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  if (el.type === "rect") drawRectExport(ctx, el, pxPerMm);
  else if (el.type === "text") drawTextExport(ctx, el, pxPerMm);
  else if (el.type === "image") await drawImageExport(ctx, el, pxPerMm);

  ctx.restore();
}

function drawRectExport(
  ctx: CanvasRenderingContext2D,
  el: RectElement,
  pxPerMm: number,
): void {
  const x = el.x * pxPerMm,
    y = el.y * pxPerMm;
  const w = el.width * pxPerMm,
    h = el.height * pxPerMm;
  const r = Math.max(0, el.cornerRadius * pxPerMm);
  const sw = Math.max(0, el.strokeWidth * pxPerMm);
  ctx.beginPath();
  roundRect(ctx, x + sw / 2, y + sw / 2, w - sw, h - sw, r);
  if (el.fill && el.fill !== "transparent") {
    ctx.fillStyle = el.fill;
    ctx.fill();
  }
  if (sw > 0) {
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = sw;
    ctx.stroke();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
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

function drawTextExport(
  ctx: CanvasRenderingContext2D,
  el: TextElement,
  pxPerMm: number,
): void {
  const x = el.x * pxPerMm,
    y = el.y * pxPerMm;
  const w = el.width * pxPerMm,
    h = el.height * pxPerMm;
  const sizePx = ((el.fontSize * 25.4) / 72) * pxPerMm;
  ctx.save();
  ctx.translate(x, y);
  ctx.font = `${el.italic ? "italic " : ""}${el.fontWeight} ${sizePx}px ${el.fontFamily}`;
  ctx.fillStyle = el.color;
  ctx.textBaseline = "alphabetic";
  const lines = wrapText(ctx, el.text, w, el.letterSpacing, sizePx);
  const lineHeight = sizePx * el.lineHeight;
  let cy = lineHeight;
  if (el.vAlign === "middle")
    cy = (h - lines.length * lineHeight) / 2 + lineHeight * 0.8;
  if (el.vAlign === "bottom")
    cy = h - (lines.length - 1) * lineHeight - lineHeight * 0.2;
  for (const line of lines) {
    drawLineExport(ctx, line, w, cy, el, sizePx);
    cy += lineHeight;
  }
  ctx.restore();
}

function measureWithSpacing(
  ctx: CanvasRenderingContext2D,
  text: string,
  ls: number,
  sizePx: number,
): number {
  if (!ls) return ctx.measureText(text).width;
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + ls * sizePx;
  return total - ls * sizePx;
}
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  ls: number,
  sizePx: number,
): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const word of words) {
      const trial = line + word;
      if (
        measureWithSpacing(ctx, trial, ls, sizePx) > maxWidth &&
        line.trim().length
      ) {
        out.push(line.replace(/\s+$/, ""));
        line = word.replace(/^\s+/, "");
      } else line = trial;
    }
    out.push(line);
  }
  return out;
}
function drawLineExport(
  ctx: CanvasRenderingContext2D,
  line: string,
  maxWidth: number,
  y: number,
  el: TextElement,
  sizePx: number,
): void {
  const lineWidth = measureWithSpacing(ctx, line, el.letterSpacing, sizePx);
  let x = 0;
  if (el.align === "center") x = (maxWidth - lineWidth) / 2;
  else if (el.align === "right") x = maxWidth - lineWidth;
  else if (el.align === "justify") {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      const wordsWidth = words.reduce(
        (a, w) => a + measureWithSpacing(ctx, w, el.letterSpacing, sizePx),
        0,
      );
      const gap = (maxWidth - wordsWidth) / (words.length - 1);
      let cx = 0;
      for (const w of words) {
        drawSpaced(ctx, w, cx, y, el.letterSpacing, sizePx);
        cx += measureWithSpacing(ctx, w, el.letterSpacing, sizePx) + gap;
      }
      return;
    }
  }
  drawSpaced(ctx, line, x, y, el.letterSpacing, sizePx);
}
function drawSpaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  ls: number,
  sizePx: number,
): void {
  if (!ls) {
    ctx.fillText(text, x, y);
    return;
  }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + ls * sizePx;
  }
}

async function drawImageExport(
  ctx: CanvasRenderingContext2D,
  el: ImageElement,
  pxPerMm: number,
): Promise<void> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(el.src);
  } catch {
    return;
  }
  const x = el.x * pxPerMm,
    y = el.y * pxPerMm;
  const w = el.width * pxPerMm,
    h = el.height * pxPerMm;
  const iw = img.naturalWidth,
    ih = img.naturalHeight;
  if (!iw || !ih) return;
  let dx = x,
    dy = y,
    dw = w,
    dh = h;
  if (el.fit === "contain") {
    const s = Math.min(w / iw, h / ih);
    dw = iw * s;
    dh = ih * s;
    dx = x + (w - dw) / 2;
    dy = y + (h - dh) / 2;
  } else if (el.fit === "cover") {
    const s = Math.max(w / iw, h / ih);
    dw = iw * s;
    dh = ih * s;
    dx = x + (w - dw) / 2;
    dy = y + (h - dh) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    return;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawCropMarks(
  ctx: CanvasRenderingContext2D,
  doc: PrintDocument,
  pxPerMm: number,
  bleed: { top: number; right: number; bottom: number; left: number },
): void {
  ctx.save();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = Math.max(1, 0.25 * pxPerMm);
  const len = 5 * pxPerMm; // 5mm marks
  const offset = 1 * pxPerMm;
  const left = bleed.left * pxPerMm;
  const top = bleed.top * pxPerMm;
  const right = (bleed.left + doc.size.width) * pxPerMm;
  const bottom = (bleed.top + doc.size.height) * pxPerMm;
  // 4 corners x 2 lines
  const lines: Array<[number, number, number, number]> = [
    // top-left
    [left - offset - len, top, left - offset, top],
    [left, top - offset - len, left, top - offset],
    // top-right
    [right + offset, top, right + offset + len, top],
    [right, top - offset - len, right, top - offset],
    // bottom-left
    [left - offset - len, bottom, left - offset, bottom],
    [left, bottom + offset, left, bottom + offset + len],
    // bottom-right
    [right + offset, bottom, right + offset + len, bottom],
    [right, bottom + offset, right, bottom + offset + len],
  ];
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of lines) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.restore();
}

function drawRegistrationMarks(
  ctx: CanvasRenderingContext2D,
  doc: PrintDocument,
  pxPerMm: number,
  bleed: { top: number; right: number; bottom: number; left: number },
): void {
  ctx.save();
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#000";
  ctx.lineWidth = Math.max(1, 0.2 * pxPerMm);
  const r = 2 * pxPerMm; // 2mm radius target
  const left = bleed.left * pxPerMm;
  const top = bleed.top * pxPerMm;
  const right = (bleed.left + doc.size.width) * pxPerMm;
  const bottom = (bleed.top + doc.size.height) * pxPerMm;
  // Centers placed in the middle of each bleed margin.
  const centers: Array<[number, number]> = [
    [(left + right) / 2, top - (bleed.top * pxPerMm) / 2], // top
    [(left + right) / 2, bottom + (bleed.bottom * pxPerMm) / 2], // bottom
    [left - (bleed.left * pxPerMm) / 2, (top + bottom) / 2], // left
    [right + (bleed.right * pxPerMm) / 2, (top + bottom) / 2], // right
  ];
  for (const [cx, cy] of centers) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.5, cy);
    ctx.lineTo(cx + r * 1.5, cy);
    ctx.moveTo(cx, cy - r * 1.5);
    ctx.lineTo(cx, cy + r * 1.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
