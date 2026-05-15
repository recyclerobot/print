import { store } from "../store";
import type { Renderer } from "../webgl/renderer";
import type {
  AnyElement,
  TextElement,
  RectElement,
  ImageElement,
} from "../types";
import { formatUnit, fromUnit, toUnit } from "../units";
import { $unit, imageMeasurementsAtom, imageDpiAtom } from "../state";
import type { ReadableAtom } from "nanostores";

// Chain-link SVG icons for the aspect-ratio lock toggle (16×16, stroke-based).
const AR_SVG = (d: string) =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const AR_ICON_LOCKED = AR_SVG(
  `<path d="M6 4v2a2 2 0 0 0 4 0V4"/><path d="M6 12v-2a2 2 0 0 1 4 0v2"/>`,
);
const AR_ICON_UNLOCKED = AR_SVG(
  `<path d="M5 4v2.5M11 4v2.5"/><path d="M5 12v-2.5M11 12v-2.5"/>`,
);

export function buildPropertiesPanel(
  host: HTMLElement,
  renderer: Renderer,
  requestRender: () => void,
): void {
  let lastSelKey = "";
  let lastPageId = "";
  // Track atom subscriptions created during the most recent rebuild so we can
  // unbind them before the next rebuild (avoids leaks + stale DOM updates).
  let activeSubs: Array<() => void> = [];
  const ctx: PanelContext = {
    addSub(unsub) {
      activeSubs.push(unsub);
    },
  };

  const render = (): void => {
    const sel = store.selected();
    const selKey = sel.map((e) => e.id).join(",");
    const pageId = store.currentPageId;
    const active = document.activeElement as HTMLElement | null;
    const editingHere =
      active &&
      host.contains(active) &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.isContentEditable);
    if (editingHere && selKey === lastSelKey && pageId === lastPageId) {
      // Skip rebuild — focused inputs keep their caret. Live readouts bound
      // to atoms via `ctx.addSub` continue to update independently.
      syncLiveTextarea(host, sel);
      return;
    }
    lastSelKey = selKey;
    lastPageId = pageId;

    // Tear down previous subscriptions before clearing the DOM.
    for (const u of activeSubs) u();
    activeSubs = [];
    host.innerHTML = "";

    if (!sel.length) {
      documentSection(host, requestRender, renderer);
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent =
        "No selection. Click an element on the canvas to edit it.";
      host.appendChild(empty);
      return;
    }
    if (sel.length > 1) {
      const m = document.createElement("div");
      m.className = "empty";
      m.textContent = `${sel.length} elements selected — multi-edit is limited to position and order.`;
      host.appendChild(m);
      transformSection(host, sel[0], requestRender);
      return;
    }
    const el = sel[0];
    sectionTitle(
      host,
      `${el.type.toUpperCase()} — ${el.name ?? el.id.slice(0, 8)}`,
    );
    transformSection(host, el, requestRender);
    if (el.type === "text") textSection(host, el, requestRender);
    if (el.type === "rect") rectSection(host, el, requestRender);
    if (el.type === "image") imageSection(host, el, requestRender, ctx);
    layerSection(host, el, requestRender, renderer);
  };
  store.subscribe(render);
  render();
}

/** Per-panel build context. Lets sections register atom subscriptions whose
 *  lifecycle is tied to the most recent panel rebuild. */
interface PanelContext {
  addSub(unsubscribe: () => void): void;
}

// When the panel skips a full rebuild because a control is focused, keep the
// non-focused inputs in sync with the latest store values. Currently we only
// need to sync transform numeric inputs and the text textarea so the user can
// see their inline-edit reflected here too.
function syncLiveTextarea(host: HTMLElement, sel: AnyElement[]): void {
  if (sel.length !== 1 || sel[0].type !== "text") return;
  const el = sel[0];
  const ta = host.querySelector(
    "textarea.text-area",
  ) as HTMLTextAreaElement | null;
  if (ta && document.activeElement !== ta && ta.value !== el.text) {
    ta.value = el.text;
  }
}

function documentSection(
  host: HTMLElement,
  requestRender: () => void,
  renderer: Renderer,
): void {
  const u = store.prefs.unit;
  sectionTitle(host, "Document");
  const grid = document.createElement("div");
  grid.className = "grid2";

  const unitSel = select(["mm", "cm", "in", "pt"], (v) => {
    store.prefs.unit = v as typeof store.prefs.unit;
    store.save();
    requestRender();
  });
  unitSel.value = u;
  grid.appendChild(field("Unit", unitSel));

  const docName = document.createElement("input");
  docName.type = "text";
  docName.value = store.doc.name;
  docName.addEventListener("change", () =>
    store.transact(() => {
      store.doc.name = docName.value;
    }),
  );
  grid.appendChild(field("Name", docName));

  // Margins
  const m = store.doc.margins;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    grid.appendChild(
      field(
        `Margin ${side}`,
        unitInput(m[side], u, (mm) => {
          store.transact(() => {
            store.doc.margins[side] = mm;
          });
          requestRender();
        }),
      ),
    );
  }
  // Bleed
  const b = store.doc.bleed;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    grid.appendChild(
      field(
        `Bleed ${side}`,
        unitInput(b[side], u, (mm) => {
          store.transact(() => {
            store.doc.bleed[side] = mm;
          });
          requestRender();
        }),
      ),
    );
  }
  // Size readout
  const sz = document.createElement("div");
  sz.className = "readout";
  sz.textContent = `${formatUnit(store.doc.size.width, u)} × ${formatUnit(store.doc.size.height, u)} (${store.doc.pages.length} page${store.doc.pages.length > 1 ? "s" : ""})`;
  host.appendChild(grid);
  host.appendChild(sz);

  // Background of current page
  const page = store.currentPage;
  if (page) {
    const bg = document.createElement("input");
    bg.type = "color";
    bg.value = page.background;
    bg.addEventListener("input", () => {
      page.background = bg.value;
      store.emit();
      requestRender();
    });
    const f = field("Page bg", bg);
    host.appendChild(f);
  }

  void renderer;
}

function transformSection(
  host: HTMLElement,
  el: AnyElement,
  requestRender: () => void,
): void {
  const u = store.prefs.unit;
  sectionTitle(host, "Transform");
  const grid = document.createElement("div");
  grid.className = "grid2";
  grid.appendChild(
    field(
      "X",
      unitInput(el.x, u, (mm) => {
        store.updateElement(el.id, { x: mm });
        requestRender();
      }),
    ),
  );
  grid.appendChild(
    field(
      "Y",
      unitInput(el.y, u, (mm) => {
        store.updateElement(el.id, { y: mm });
        requestRender();
      }),
    ),
  );

  // --- W / H with aspect-ratio lock ----------------------------------------
  // Render W, the chain-link toggle, and H as a single row that spans both
  // columns of the grid so W and H sit visually side-by-side with the lock
  // wedged between them (Figma / Photoshop pattern).
  //
  // For image elements that are repeated, W/H represent the *tile* (single
  // image) size, NOT the full bounding box. The bounding box is derived as
  //   bbox = tile * count + gap * (count - 1)
  // This matches the user's mental model: "W and H are the image's own
  // dimensions; the repeat counts simply tile it across the canvas."
  const isImage = el.type === "image";
  const img = isImage ? (el as ImageElement) : null;
  const rx = img?.repeatX ?? 1;
  const ry = img?.repeatY ?? 1;
  const gap = img?.repeatGap ?? 0;
  const tileW = isImage ? (el.width - gap * (rx - 1)) / rx : el.width;
  const tileH = isImage ? (el.height - gap * (ry - 1)) / ry : el.height;
  const ratio = tileW / tileH;
  const arLocked = el.aspectRatioLocked ?? false;

  const wField = field(
    isImage ? "W (image)" : "W",
    unitInput(tileW, u, (mm) => {
      const newTileW = Math.max(1, mm);
      if (isImage) {
        const newTileH = el.aspectRatioLocked
          ? Math.max(1, newTileW / ratio)
          : tileH;
        store.updateElement(el.id, {
          width: newTileW * rx + gap * (rx - 1),
          height: newTileH * ry + gap * (ry - 1),
        });
      } else {
        const patch: Partial<AnyElement> = { width: newTileW };
        if (el.aspectRatioLocked) patch.height = Math.max(1, newTileW / ratio);
        store.updateElement(el.id, patch);
      }
      requestRender();
    }),
  );

  const lockBtn = document.createElement("button");
  lockBtn.type = "button";
  lockBtn.className = "ar-lock" + (arLocked ? " on" : "");
  lockBtn.title = arLocked
    ? "Aspect ratio locked – click to unlock"
    : "Aspect ratio unlocked – click to lock";
  lockBtn.innerHTML = arLocked ? AR_ICON_LOCKED : AR_ICON_UNLOCKED;
  lockBtn.addEventListener("click", () => {
    store.updateElement(el.id, {
      aspectRatioLocked: !el.aspectRatioLocked,
    });
    requestRender();
  });

  const hField = field(
    isImage ? "H (image)" : "H",
    unitInput(tileH, u, (mm) => {
      const newTileH = Math.max(1, mm);
      if (isImage) {
        const newTileW = el.aspectRatioLocked
          ? Math.max(1, newTileH * ratio)
          : tileW;
        store.updateElement(el.id, {
          width: newTileW * rx + gap * (rx - 1),
          height: newTileH * ry + gap * (ry - 1),
        });
      } else {
        const patch: Partial<AnyElement> = { height: newTileH };
        if (el.aspectRatioLocked) patch.width = Math.max(1, newTileH * ratio);
        store.updateElement(el.id, patch);
      }
      requestRender();
    }),
  );

  const whRow = document.createElement("div");
  whRow.className = "wh-row";
  whRow.appendChild(wField);
  whRow.appendChild(lockBtn);
  whRow.appendChild(hField);
  grid.appendChild(whRow);

  grid.appendChild(
    field(
      "Rotation°",
      numberInput(el.rotation, -360, 360, 1, (v) => {
        store.updateElement(el.id, { rotation: v });
        requestRender();
      }),
    ),
  );
  grid.appendChild(
    field(
      "Opacity",
      numberInput(el.opacity, 0, 1, 0.05, (v) => {
        store.updateElement(el.id, { opacity: v });
        requestRender();
      }),
    ),
  );
  host.appendChild(grid);
}

function textSection(
  host: HTMLElement,
  el: TextElement,
  requestRender: () => void,
): void {
  sectionTitle(host, "Typography");
  const ta = document.createElement("textarea");
  ta.className = "text-area";
  ta.value = el.text;
  ta.rows = 4;
  ta.addEventListener("input", () => {
    store.updateElement(el.id, { text: ta.value });
    requestRender();
  });
  host.appendChild(field("Text", ta));

  const grid = document.createElement("div");
  grid.className = "grid2";
  const fontFamilies = [
    "Helvetica, Arial, sans-serif",
    "Georgia, serif",
    "Times New Roman, serif",
    "Courier New, monospace",
    "Verdana, sans-serif",
    "Tahoma, sans-serif",
    "Trebuchet MS, sans-serif",
    "Palatino, serif",
    "Garamond, serif",
    "system-ui, sans-serif",
  ];
  const ff = select(fontFamilies, (v) => {
    store.updateElement(el.id, { fontFamily: v });
    requestRender();
  });
  ff.value = el.fontFamily;
  grid.appendChild(field("Font", ff));

  grid.appendChild(
    field(
      "Size (pt)",
      numberInput(el.fontSize, 4, 400, 0.5, (v) => {
        store.updateElement(el.id, { fontSize: v });
        requestRender();
      }),
    ),
  );
  const weight = select(
    ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
    (v) => {
      store.updateElement(el.id, { fontWeight: parseInt(v, 10) });
      requestRender();
    },
  );
  weight.value = String(el.fontWeight);
  grid.appendChild(field("Weight", weight));

  const ital = checkbox(el.italic, (v) => {
    store.updateElement(el.id, { italic: v });
    requestRender();
  });
  grid.appendChild(field("Italic", ital));

  const color = document.createElement("input");
  color.type = "color";
  color.value = el.color;
  color.addEventListener("input", () => {
    store.updateElement(el.id, { color: color.value });
    requestRender();
  });
  grid.appendChild(field("Color", color));

  grid.appendChild(
    field(
      "Line height",
      numberInput(el.lineHeight, 0.5, 5, 0.05, (v) => {
        store.updateElement(el.id, { lineHeight: v });
        requestRender();
      }),
    ),
  );
  grid.appendChild(
    field(
      "Tracking (em)",
      numberInput(el.letterSpacing, -0.2, 1, 0.005, (v) => {
        store.updateElement(el.id, { letterSpacing: v });
        requestRender();
      }),
    ),
  );

  const align = select(["left", "center", "right", "justify"], (v) => {
    store.updateElement(el.id, { align: v as TextElement["align"] });
    requestRender();
  });
  align.value = el.align;
  grid.appendChild(field("Align", align));

  const valign = select(["top", "middle", "bottom"], (v) => {
    store.updateElement(el.id, { vAlign: v as TextElement["vAlign"] });
    requestRender();
  });
  valign.value = el.vAlign;
  grid.appendChild(field("V-Align", valign));
  host.appendChild(grid);
}

function rectSection(
  host: HTMLElement,
  el: RectElement,
  requestRender: () => void,
): void {
  sectionTitle(host, "Shape");
  const grid = document.createElement("div");
  grid.className = "grid2";
  const fill = document.createElement("input");
  fill.type = "color";
  fill.value = el.fill;
  fill.addEventListener("input", () => {
    store.updateElement(el.id, { fill: fill.value });
    requestRender();
  });
  grid.appendChild(field("Fill", fill));
  const stroke = document.createElement("input");
  stroke.type = "color";
  stroke.value = el.stroke;
  stroke.addEventListener("input", () => {
    store.updateElement(el.id, { stroke: stroke.value });
    requestRender();
  });
  grid.appendChild(field("Stroke", stroke));
  grid.appendChild(
    field(
      "Stroke W",
      unitInput(el.strokeWidth, store.prefs.unit, (mm) => {
        store.updateElement(el.id, { strokeWidth: mm });
        requestRender();
      }),
    ),
  );
  grid.appendChild(
    field(
      "Corner",
      unitInput(el.cornerRadius, store.prefs.unit, (mm) => {
        store.updateElement(el.id, { cornerRadius: mm });
        requestRender();
      }),
    ),
  );
  host.appendChild(grid);
}

function imageSection(
  host: HTMLElement,
  el: ImageElement,
  requestRender: () => void,
  ctx: PanelContext,
): void {
  sectionTitle(host, "Image");
  const grid = document.createElement("div");
  grid.className = "grid2";
  const fit = select(["contain", "cover", "fill"], (v) => {
    store.updateElement(el.id, { fit: v as ImageElement["fit"] });
    requestRender();
  });
  fit.value = el.fit;
  grid.appendChild(field("Fit", fit));

  // ----- Live, atom-bound readouts -----------------------------------------
  // Each readout is a DOM node bound to a computed atom. When repeat values
  // change (or the unit), the atom recomputes and the node updates without
  // requiring a full panel rebuild. This avoids the stale-derived-value bug.

  const measurements$ = imageMeasurementsAtom(el.id);
  const dpi$ = imageDpiAtom(el.id);

  if (el.naturalWidth && el.naturalHeight) {
    const r = document.createElement("div");
    r.className = "readout small";
    r.textContent = `${el.naturalWidth} × ${el.naturalHeight}px`;
    grid.appendChild(field("Source", r));

    // Print DPI readout — bound to dpi atom which depends on tile size.
    const dpiEl = document.createElement("div");
    dpiEl.className = "readout small dpi-readout";
    grid.appendChild(field("Print DPI", dpiEl));

    ctx.addSub(
      dpi$.subscribe((d) => {
        if (!d) return;
        const rounded = Math.round(d.dpi);
        dpiEl.classList.remove("ok", "warn", "bad");
        let cls = "ok";
        let label = "Excellent";
        if (rounded < 150) {
          cls = "bad";
          label = "Low — may look pixelated in print";
        } else if (rounded < 220) {
          cls = "warn";
          label = "OK for draft prints";
        } else if (rounded < 300) {
          cls = "warn";
          label = "Good";
        }
        dpiEl.classList.add(cls);
        dpiEl.textContent = `${rounded} DPI`;
        dpiEl.title = `${label} (${Math.round(d.dpiW)} × ${Math.round(d.dpiH)} DPI)`;
      }),
    );
  }

  // "Total area" readout (full width below the grid) — only visible when
  // the image is repeated. Placed here so it sits between the Image header
  // and the Repeat section, never out of order.
  const totalR = makeReadout("readout small total-area");
  const totalField = field("Total area", totalR);
  totalField.style.display = "none";

  ctx.addSub(
    bindBoth(measurements$, $unit, (m, u) => {
      if (!m) return;
      if (m.isRepeated) {
        totalField.style.display = "";
        totalR.textContent = `${formatUnit(m.totalWidth, u)} × ${formatUnit(m.totalHeight, u)}`;
      } else {
        totalField.style.display = "none";
      }
    }),
  );

  // Append the Image grid and the total-area readout BEFORE building the
  // Repeat section so DOM order matches visual order.
  host.appendChild(grid);
  host.appendChild(totalField);

  // --- Repeat controls ---
  // W/H in the Transform section now control the *image* (tile) dimensions.
  // The Repeat section just sets how many times that tile is laid out
  // horizontally and vertically. The element's bounding box is derived as
  //   bbox = tile * count + gap * (count - 1)
  // and updated on every change so the canvas reflects the new layout.
  sectionTitle(host, "Repeat");
  const rGrid = document.createElement("div");
  rGrid.className = "grid2";

  const u2 = store.prefs.unit;

  // Snapshot the current tile dimensions; recomputing the bounding box on
  // every count / gap change requires knowing the per-tile size, which is
  // stable across this section's lifetime (changes to W/H rebuild the panel).
  const curRx = el.repeatX ?? 1;
  const curRy = el.repeatY ?? 1;
  const curGap = el.repeatGap ?? 0;
  const curTileW = (el.width - curGap * (curRx - 1)) / curRx;
  const curTileH = (el.height - curGap * (curRy - 1)) / curRy;

  const rxInput = numberInput(curRx, 1, 100, 1, (v) => {
    const newRx = Math.max(1, Math.round(v));
    store.updateElement(el.id, {
      repeatX: newRx,
      width: curTileW * newRx + curGap * (newRx - 1),
    });
    requestRender();
  });
  rGrid.appendChild(field("Horizontal ×", rxInput));

  const ryInput = numberInput(curRy, 1, 100, 1, (v) => {
    const newRy = Math.max(1, Math.round(v));
    store.updateElement(el.id, {
      repeatY: newRy,
      height: curTileH * newRy + curGap * (newRy - 1),
    });
    requestRender();
  });
  rGrid.appendChild(field("Vertical ×", ryInput));

  // Gap on its own full-width row beneath the count pair.
  const gapRow = document.createElement("div");
  gapRow.className = "full-row";
  gapRow.appendChild(
    field(
      "Gap",
      unitInput(curGap, u2, (mm) => {
        const newGap = Math.max(0, mm);
        store.updateElement(el.id, {
          repeatGap: newGap,
          width: curTileW * curRx + newGap * (curRx - 1),
          height: curTileH * curRy + newGap * (curRy - 1),
        });
        requestRender();
      }),
    ),
  );

  // Keep count inputs in sync when something else changes them (undo, etc.).
  // Skip when the input is focused so we don't fight the user's typing.
  ctx.addSub(
    measurements$.subscribe((m) => {
      if (!m) return;
      if (document.activeElement !== rxInput) rxInput.value = String(m.repeatX);
      if (document.activeElement !== ryInput) ryInput.value = String(m.repeatY);
    }),
  );

  // "Fill page" button — keep the current tile size, compute how many tiles
  // fit on the page horizontally and vertically (gap-aware), and resize the
  // element bounding box to exactly cover those tiles, anchored to (0, 0).
  const fillBtn = document.createElement("button");
  fillBtn.type = "button";
  fillBtn.className = "btn fill-page-btn";
  fillBtn.textContent = "Fill page with image";
  fillBtn.title =
    "Repeat the image as many times as fits on the page using its current W and H.";
  fillBtn.addEventListener("click", () => {
    const page = store.doc.size;
    const fitCount = (tile: number, span: number, g: number): number => {
      if (tile <= 0) return 1;
      // n*tile + (n-1)*g ≤ span  →  n ≤ (span + g) / (tile + g)
      return Math.max(1, Math.floor((span + g) / (tile + g)));
    };
    const newRx = fitCount(curTileW, page.width, curGap);
    const newRy = fitCount(curTileH, page.height, curGap);
    store.updateElement(el.id, {
      x: 0,
      y: 0,
      repeatX: newRx,
      repeatY: newRy,
      width: curTileW * newRx + curGap * (newRx - 1),
      height: curTileH * newRy + curGap * (newRy - 1),
    });
    requestRender();
  });
  host.appendChild(rGrid);
  host.appendChild(gapRow);
  host.appendChild(fillBtn);
}

// Helper: subscribe to two atoms together and call cb with both values.
function bindBoth<A, B>(
  a$: ReadableAtom<A>,
  b$: ReadableAtom<B>,
  cb: (a: A, b: B) => void,
): () => void {
  const u1 = a$.subscribe(() => cb(a$.get(), b$.get()));
  const u2 = b$.subscribe(() => cb(a$.get(), b$.get()));
  return () => {
    u1();
    u2();
  };
}

function makeReadout(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

function layerSection(
  host: HTMLElement,
  el: AnyElement,
  requestRender: () => void,
  renderer: Renderer,
): void {
  sectionTitle(host, "Layer");
  const row = document.createElement("div");
  row.className = "btn-row";
  const mk = (label: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.className = "btn small";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };
  row.appendChild(
    mk("To front", () => {
      store.reorder(el.id, 999);
      requestRender();
    }),
  );
  row.appendChild(
    mk("Forward", () => {
      store.reorder(el.id, 1);
      requestRender();
    }),
  );
  row.appendChild(
    mk("Backward", () => {
      store.reorder(el.id, -1);
      requestRender();
    }),
  );
  row.appendChild(
    mk("To back", () => {
      store.reorder(el.id, -999);
      requestRender();
    }),
  );
  host.appendChild(row);
  const row2 = document.createElement("div");
  row2.className = "btn-row";
  row2.appendChild(
    mk(el.locked ? "Unlock" : "Lock", () => {
      store.updateElement(el.id, { locked: !el.locked });
      requestRender();
    }),
  );
  row2.appendChild(
    mk(el.hidden ? "Show" : "Hide", () => {
      store.updateElement(el.id, { hidden: !el.hidden });
      requestRender();
    }),
  );
  row2.appendChild(
    mk("Delete", () => {
      store.removeSelected();
      requestRender();
    }),
  );
  host.appendChild(row2);
  void renderer;
}

// --- helpers ---

function sectionTitle(host: HTMLElement, title: string): void {
  const h = document.createElement("div");
  h.className = "section-title";
  h.textContent = title;
  host.appendChild(h);
}

function field(label: string, control: HTMLElement): HTMLElement {
  const w = document.createElement("label");
  w.className = "field";
  const s = document.createElement("span");
  s.textContent = label;
  w.appendChild(s);
  w.appendChild(control);
  return w;
}

function unitInput(
  mm: number,
  unit: "mm" | "cm" | "in" | "pt",
  onChange: (mm: number) => void,
): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "number";
  i.value = toUnit(mm, unit).toFixed(unit === "mm" || unit === "pt" ? 1 : 3);
  i.step = unit === "mm" || unit === "pt" ? "0.5" : "0.01";
  i.className = "num";
  i.addEventListener("change", () =>
    onChange(fromUnit(parseFloat(i.value), unit)),
  );
  return i;
}
function numberInput(
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "number";
  i.value = String(value);
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.className = "num";
  i.addEventListener("input", () => onChange(parseFloat(i.value)));
  return i;
}
function select(
  options: string[],
  onChange: (v: string) => void,
): HTMLSelectElement {
  const s = document.createElement("select");
  s.className = "select";
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    s.appendChild(opt);
  }
  s.addEventListener("change", () => onChange(s.value));
  return s;
}
function checkbox(
  checked: boolean,
  onChange: (v: boolean) => void,
): HTMLInputElement {
  const c = document.createElement("input");
  c.type = "checkbox";
  c.checked = checked;
  c.addEventListener("change", () => onChange(c.checked));
  return c;
}
