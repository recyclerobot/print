import { store } from "./store";
import type { Renderer } from "./webgl/renderer";
import type { AnyElement } from "./types";

interface DragState {
  mode: "move" | "resize" | "pan" | "marquee" | null;
  startX: number;
  startY: number;
  startMm: { x: number; y: number };
  initial: Map<string, { x: number; y: number; w: number; h: number }>;
  resizeHandle?: "nw" | "ne" | "sw" | "se";
  resizeId?: string;
}

const HANDLE_SIZE_PX = 12;

export function attachInteraction(
  canvas: HTMLCanvasElement,
  renderer: Renderer,
  requestRender: () => void,
): void {
  const drag: DragState = {
    mode: null,
    startX: 0,
    startY: 0,
    startMm: { x: 0, y: 0 },
    initial: new Map(),
  };
  let snapLines: SnapLine[] = [];

  function hitTest(
    mx: number,
    my: number,
  ): {
    el?: AnyElement;
    handle?: "nw" | "ne" | "sw" | "se";
    handleId?: string;
  } {
    const page = store.currentPage;
    if (!page) return {};
    // Handles for currently selected elements take priority.
    const tolMm = HANDLE_SIZE_PX / renderer.view.zoom;
    for (const id of store.selectedIds) {
      const el = page.elements.find((e) => e.id === id);
      if (!el) continue;
      const corners: Array<["nw" | "ne" | "sw" | "se", number, number]> = [
        ["nw", el.x, el.y],
        ["ne", el.x + el.width, el.y],
        ["sw", el.x, el.y + el.height],
        ["se", el.x + el.width, el.y + el.height],
      ];
      for (const [h, hx, hy] of corners) {
        if (Math.abs(mx - hx) <= tolMm && Math.abs(my - hy) <= tolMm) {
          return { el, handle: h, handleId: id };
        }
      }
    }
    // Topmost element under the cursor (ignore rotation for hit-test simplicity).
    for (let i = page.elements.length - 1; i >= 0; i--) {
      const el = page.elements[i];
      if (el.hidden || el.locked) continue;
      if (
        mx >= el.x &&
        mx <= el.x + el.width &&
        my >= el.y &&
        my <= el.y + el.height
      ) {
        return { el };
      }
    }
    return {};
  }

  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    canvas.focus();
    const mm = renderer.screenToMm(e.clientX, e.clientY);
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      drag.mode = "pan";
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.startMm = { x: renderer.view.panX, y: renderer.view.panY };
      return;
    }
    const hit = hitTest(mm.x, mm.y);
    const page = store.currentPage;
    if (!page) return;
    if (hit.handle && hit.handleId) {
      drag.mode = "resize";
      drag.resizeHandle = hit.handle;
      drag.resizeId = hit.handleId;
      drag.startMm = mm;
      drag.initial.clear();
      const el = page.elements.find((p) => p.id === hit.handleId)!;
      drag.initial.set(el.id, { x: el.x, y: el.y, w: el.width, h: el.height });
      store.pushHistory();
    } else if (hit.el) {
      const additive = e.shiftKey;
      if (!store.selectedIds.has(hit.el.id)) {
        if (additive) store.selectedIds.add(hit.el.id);
        else store.setSelection(hit.el.id);
      } else if (additive) {
        store.selectedIds.delete(hit.el.id);
        store.emit();
      }
      drag.mode = "move";
      drag.startMm = mm;
      drag.initial.clear();
      for (const id of store.selectedIds) {
        const el = page.elements.find((p) => p.id === id);
        if (el)
          drag.initial.set(id, { x: el.x, y: el.y, w: el.width, h: el.height });
      }
      store.pushHistory();
    } else {
      store.setSelection(null);
      drag.mode = "pan";
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.startMm = { x: renderer.view.panX, y: renderer.view.panY };
    }
    requestRender();
  });

  window.addEventListener("mousemove", (e) => {
    if (!drag.mode) {
      // Cursor feedback
      const mm = renderer.screenToMm(e.clientX, e.clientY);
      const hit = hitTest(mm.x, mm.y);
      if (hit.handle === "nw" || hit.handle === "se")
        canvas.style.cursor = "nwse-resize";
      else if (hit.handle === "ne" || hit.handle === "sw")
        canvas.style.cursor = "nesw-resize";
      else if (hit.el) canvas.style.cursor = "move";
      else canvas.style.cursor = "default";
      return;
    }
    if (drag.mode === "pan") {
      const dx = (e.clientX - drag.startX) / renderer.view.zoom;
      const dy = (e.clientY - drag.startY) / renderer.view.zoom;
      renderer.view.panX = drag.startMm.x - dx;
      renderer.view.panY = drag.startMm.y - dy;
      requestRender();
      return;
    }
    const mm = renderer.screenToMm(e.clientX, e.clientY);
    const page = store.currentPage;
    if (!page) return;
    if (drag.mode === "move") {
      let dx = mm.x - drag.startMm.x;
      let dy = mm.y - drag.startMm.y;
      // Snap selection bounds
      if (store.prefs.snapEnabled && drag.initial.size) {
        const movingIds = new Set(drag.initial.keys());
        let bx0 = Infinity,
          by0 = Infinity,
          bx1 = -Infinity,
          by1 = -Infinity;
        for (const [id, init] of drag.initial) {
          const x = init.x + dx,
            y = init.y + dy;
          bx0 = Math.min(bx0, x);
          by0 = Math.min(by0, y);
          bx1 = Math.max(bx1, x + init.w);
          by1 = Math.max(by1, y + init.h);
          void id;
        }
        const snap = computeSnap(
          bx0,
          by0,
          bx1,
          by1,
          store.doc,
          page.elements,
          movingIds,
          store.prefs.snapTolerance / renderer.view.zoom,
        );
        dx += snap.dx;
        dy += snap.dy;
        snapLines = snap.lines;
      } else {
        snapLines = [];
      }
      for (const [id, init] of drag.initial) {
        const el = page.elements.find((p) => p.id === id);
        if (el) {
          el.x = init.x + dx;
          el.y = init.y + dy;
        }
      }
      store.emit();
      requestRender();
    } else if (drag.mode === "resize" && drag.resizeId && drag.resizeHandle) {
      const init = drag.initial.get(drag.resizeId)!;
      const el = page.elements.find((p) => p.id === drag.resizeId);
      if (!el) return;
      let nx = init.x,
        ny = init.y,
        nw = init.w,
        nh = init.h;
      const mx = mm.x,
        my = mm.y;
      if (drag.resizeHandle.includes("e")) nw = Math.max(2, mx - init.x);
      if (drag.resizeHandle.includes("s")) nh = Math.max(2, my - init.y);
      if (drag.resizeHandle.includes("w")) {
        nx = mx;
        nw = Math.max(2, init.x + init.w - mx);
      }
      if (drag.resizeHandle.includes("n")) {
        ny = my;
        nh = Math.max(2, init.y + init.h - my);
      }
      // Aspect ratio with shift
      if (e.shiftKey && init.w && init.h) {
        const aspect = init.w / init.h;
        if (nw / nh > aspect) nw = nh * aspect;
        else nh = nw / aspect;
        if (drag.resizeHandle.includes("w")) nx = init.x + init.w - nw;
        if (drag.resizeHandle.includes("n")) ny = init.y + init.h - nh;
      }
      if (store.prefs.snapEnabled) {
        const snap = computeSnap(
          nx,
          ny,
          nx + nw,
          ny + nh,
          store.doc,
          page.elements,
          new Set([el.id]),
          store.prefs.snapTolerance / renderer.view.zoom,
        );
        snapLines = snap.lines;
      }
      el.x = nx;
      el.y = ny;
      el.width = nw;
      el.height = nh;
      store.emit();
      requestRender();
    }
  });

  window.addEventListener("mouseup", () => {
    if (drag.mode) {
      drag.mode = null;
      drag.initial.clear();
      snapLines = [];
      requestRender();
    }
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        renderer.zoomAt(e.clientX, e.clientY, factor);
      } else {
        renderer.view.panX += e.deltaX / renderer.view.zoom;
        renderer.view.panY += e.deltaY / renderer.view.zoom;
      }
      requestRender();
    },
    { passive: false },
  );

  // Keyboard: delete, arrows, undo/redo
  window.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (
      (e.key === "Backspace" || e.key === "Delete") &&
      store.selectedIds.size
    ) {
      e.preventDefault();
      store.removeSelected();
      requestRender();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      renderer.invalidate();
      requestRender();
    } else if (
      (e.metaKey || e.ctrlKey) &&
      (e.key === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))
    ) {
      e.preventDefault();
      store.redo();
      renderer.invalidate();
      requestRender();
    } else if (e.key.startsWith("Arrow") && store.selectedIds.size) {
      e.preventDefault();
      const step = e.shiftKey ? 5 : 0.5; // mm
      const dx =
        e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      store.transact(() => {
        for (const id of store.selectedIds) {
          const el = store.currentPage?.elements.find((e) => e.id === id);
          if (el) {
            el.x += dx;
            el.y += dy;
          }
        }
      });
      requestRender();
    } else if (e.key === "0" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      renderer.fitToScreen();
      requestRender();
    }
  });

  // Expose snap line getter for overlay
  (window as unknown as { __snapLines: () => SnapLine[] }).__snapLines = () =>
    snapLines;
}

export interface SnapLine {
  orient: "v" | "h";
  pos: number; // mm
}

function computeSnap(
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
  doc: import("./types").PrintDocument,
  elements: AnyElement[],
  ignore: Set<string>,
  tol: number,
): { dx: number; dy: number; lines: SnapLine[] } {
  const cx = (bx0 + bx1) / 2;
  const cy = (by0 + by1) / 2;
  const w = doc.size.width,
    h = doc.size.height;
  const m = doc.margins;

  const xCandidates: Array<{ pos: number; from: number }> = [];
  const yCandidates: Array<{ pos: number; from: number }> = [];

  // Page edges, center, margins
  const pageX = [0, w / 2, w, m.left, w - m.right];
  const pageY = [0, h / 2, h, m.top, h - m.bottom];
  const sourceX = [bx0, cx, bx1];
  const sourceY = [by0, cy, by1];
  for (const px of pageX)
    for (const sx of sourceX) xCandidates.push({ pos: px, from: sx });
  for (const py of pageY)
    for (const sy of sourceY) yCandidates.push({ pos: py, from: sy });

  // Other elements
  for (const el of elements) {
    if (ignore.has(el.id)) continue;
    const ex = [el.x, el.x + el.width / 2, el.x + el.width];
    const ey = [el.y, el.y + el.height / 2, el.y + el.height];
    for (const ep of ex)
      for (const sx of sourceX) xCandidates.push({ pos: ep, from: sx });
    for (const ep of ey)
      for (const sy of sourceY) yCandidates.push({ pos: ep, from: sy });
  }

  let bestDx = 0,
    bestX = Infinity;
  let bestDy = 0,
    bestY = Infinity;
  let xLine: number | null = null,
    yLine: number | null = null;
  for (const c of xCandidates) {
    const d = c.pos - c.from;
    if (Math.abs(d) < tol && Math.abs(d) < bestX) {
      bestX = Math.abs(d);
      bestDx = d;
      xLine = c.pos;
    }
  }
  for (const c of yCandidates) {
    const d = c.pos - c.from;
    if (Math.abs(d) < tol && Math.abs(d) < bestY) {
      bestY = Math.abs(d);
      bestDy = d;
      yLine = c.pos;
    }
  }
  const lines: SnapLine[] = [];
  if (xLine !== null) lines.push({ orient: "v", pos: xLine });
  if (yLine !== null) lines.push({ orient: "h", pos: yLine });
  return { dx: bestDx, dy: bestDy, lines };
}
