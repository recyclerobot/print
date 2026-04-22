import { store } from "../store";
import type { Renderer } from "../webgl/renderer";
import { toUnit } from "../units";

export interface RulerHandles {
  top: HTMLCanvasElement;
  left: HTMLCanvasElement;
  draw: () => void;
}

export function createRulers(
  host: HTMLElement,
  renderer: Renderer,
): RulerHandles {
  const top = document.createElement("canvas");
  const left = document.createElement("canvas");
  top.className = "ruler ruler-top";
  left.className = "ruler ruler-left";
  host.appendChild(top);
  host.appendChild(left);
  const corner = document.createElement("div");
  corner.className = "ruler-corner";
  host.appendChild(corner);

  function draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const r = host.getBoundingClientRect();
    const RW = 22; // ruler thickness in CSS px
    const wPx = Math.max(1, Math.floor((r.width - RW) * dpr));
    const hPx = Math.max(1, Math.floor((r.height - RW) * dpr));
    top.width = wPx;
    top.height = Math.floor(RW * dpr);
    top.style.width = `${r.width - RW}px`;
    top.style.height = `${RW}px`;
    top.style.left = `${RW}px`;
    top.style.top = "0";
    left.width = Math.floor(RW * dpr);
    left.height = hPx;
    left.style.width = `${RW}px`;
    left.style.height = `${r.height - RW}px`;
    left.style.left = "0";
    left.style.top = `${RW}px`;
    corner.style.width = `${RW}px`;
    corner.style.height = `${RW}px`;

    drawAxis(top, "h", dpr, renderer);
    drawAxis(left, "v", dpr, renderer);
  }

  return { top, left, draw };
}

function drawAxis(
  canvas: HTMLCanvasElement,
  orient: "h" | "v",
  dpr: number,
  renderer: Renderer,
): void {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width,
    H = canvas.height;
  ctx.fillStyle = "#1c1c1f";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#3a3a40";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (orient === "h") {
    ctx.moveTo(0, H - 0.5);
    ctx.lineTo(W, H - 0.5);
  } else {
    ctx.moveTo(W - 0.5, 0);
    ctx.lineTo(W - 0.5, H);
  }
  ctx.stroke();

  const unit = store.prefs.unit;
  const zoom = renderer.view.zoom * dpr; // px per mm in canvas space
  // pixels per "unit" in canvas
  let unitMm = 1;
  switch (unit) {
    case "mm":
      unitMm = 1;
      break;
    case "cm":
      unitMm = 10;
      break;
    case "in":
      unitMm = 25.4;
      break;
    case "pt":
      unitMm = 25.4 / 72;
      break;
  }
  const pxPerUnit = unitMm * zoom;

  // Choose major step so labels are spaced ~60-100px apart.
  const targetPx = 80 * dpr;
  let step = 1;
  const candidates = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (const c of candidates) {
    if (c * pxPerUnit >= targetPx) {
      step = c;
      break;
    }
    step = c;
  }
  const minor = step / 5;

  // Determine the visible mm range mapped to ruler pixel space.
  // Ruler 0 corresponds to canvas left/top (in CSS px).
  const rulerStartMm = orient === "h" ? renderer.view.panX : renderer.view.panY;
  const rulerEndMm = rulerStartMm + (orient === "h" ? W : H) / zoom;

  // Highlight page area
  const pageStart = 0;
  const pageEnd =
    orient === "h" ? renderer.doc.size.width : renderer.doc.size.height;
  const psPx = (pageStart - rulerStartMm) * zoom;
  const pePx = (pageEnd - rulerStartMm) * zoom;
  ctx.fillStyle = "#2a2a30";
  if (orient === "h") ctx.fillRect(psPx, 0, pePx - psPx, H);
  else ctx.fillRect(0, psPx, W, pePx - psPx);

  ctx.strokeStyle = "#6e6e78";
  ctx.fillStyle = "#cfcfd6";
  ctx.font = `${10 * dpr}px system-ui, sans-serif`;
  ctx.textBaseline = orient === "h" ? "top" : "middle";
  ctx.textAlign = orient === "h" ? "left" : "right";

  // minor ticks
  const startUnit = Math.floor(rulerStartMm / unitMm / minor) * minor;
  const endUnit = Math.ceil(rulerEndMm / unitMm / minor) * minor;
  ctx.beginPath();
  for (let u = startUnit; u <= endUnit; u += minor) {
    const mm = u * unitMm;
    const px = (mm - rulerStartMm) * zoom;
    if (orient === "h") {
      const isMajor = Math.abs(u / step - Math.round(u / step)) < 1e-6;
      const len = isMajor ? H * 0.6 : H * 0.3;
      ctx.moveTo(px + 0.5, H - len);
      ctx.lineTo(px + 0.5, H);
    } else {
      const isMajor = Math.abs(u / step - Math.round(u / step)) < 1e-6;
      const len = isMajor ? W * 0.6 : W * 0.3;
      ctx.moveTo(W - len, px + 0.5);
      ctx.lineTo(W, px + 0.5);
    }
  }
  ctx.stroke();

  // major labels
  const majorStartUnit = Math.floor(rulerStartMm / unitMm / step) * step;
  const majorEndUnit = Math.ceil(rulerEndMm / unitMm / step) * step;
  for (let u = majorStartUnit; u <= majorEndUnit; u += step) {
    const mm = u * unitMm;
    const px = (mm - rulerStartMm) * zoom;
    const label = toUnit(mm, unit).toFixed(step >= 1 ? 0 : 1);
    if (orient === "h") ctx.fillText(label, px + 2 * dpr, 1 * dpr);
    else {
      ctx.save();
      ctx.translate(W - 2 * dpr, px);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "left";
      ctx.fillText(label, 2 * dpr, 0);
      ctx.restore();
    }
  }
}
