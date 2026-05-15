import { store } from "../store";
import type { Renderer } from "../webgl/renderer";
import type {
  AnyElement,
  TextElement,
  RectElement,
  ImageElement,
} from "../types";
import { formatUnit, fromUnit, toUnit } from "../units";
import {
  $unit,
  imageMeasurementsAtom,
  imageDpiAtom,
} from "../state";
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
  const ratio = el.width / el.height;
  const arLocked = el.aspectRatioLocked ?? false;
  grid.appendChild(
    field(
      "W",
      unitInput(el.width, u, (mm) => {
        const w = Math.max(1, mm);
        const patch: Partial<AnyElement> = { width: w };
        if (el.aspectRatioLocked) patch.height = Math.max(1, w / ratio);
        store.updateElement(el.id, patch);
        requestRender();
      }),
    ),
  );

  // Chain-link toggle button between W and H (Figma / Photoshop pattern).
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
  grid.appendChild(lockBtn);

  grid.appendChild(
    field(
      "H",
      unitInput(el.height, u, (mm) => {
        const h = Math.max(1, mm);
        const patch: Partial<AnyElement> = { height: h };
        if (el.aspectRatioLocked) patch.width = Math.max(1, h * ratio);
        store.updateElement(el.id, patch);
        requestRender();
      }),
    ),
  );

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

  // "Total area" + "Tile size" — only visible when the image is repeated.
  const totalR = makeReadout("readout small");
  const totalField = field("Total area", totalR);
  totalField.style.display = "none";
  grid.appendChild(totalField);

  const tileR = makeReadout("readout small");
  const tileField = field("Tile size", tileR);
  tileField.style.display = "none";
  grid.appendChild(tileField);

  ctx.addSub(
    bindBoth(measurements$, $unit, (m, u) => {
      if (!m) return;
      if (m.isRepeated) {
        totalField.style.display = "";
        tileField.style.display = "";
        totalR.textContent = `${formatUnit(m.totalWidth, u)} × ${formatUnit(m.totalHeight, u)}`;
        tileR.textContent = `${formatUnit(m.tileWidth, u)} × ${formatUnit(m.tileHeight, u)}`;
      } else {
        totalField.style.display = "none";
        tileField.style.display = "none";
      }
    }),
  );

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

  // --- Repeat controls ---
  sectionTitle(host, "Repeat");
  const rGrid = document.createElement("div");
  rGrid.className = "grid2";
  rGrid.appendChild(
    field(
      "Horizontal",
      numberInput(el.repeatX ?? 1, 1, 50, 1, (v) => {
        store.updateElement(el.id, { repeatX: Math.max(1, Math.round(v)) });
        requestRender();
      }),
    ),
  );
  rGrid.appendChild(
    field(
      "Vertical",
      numberInput(el.repeatY ?? 1, 1, 50, 1, (v) => {
        store.updateElement(el.id, { repeatY: Math.max(1, Math.round(v)) });
        requestRender();
      }),
    ),
  );
  const u2 = store.prefs.unit;
  rGrid.appendChild(
    field(
      "Gap",
      unitInput(el.repeatGap ?? 0, u2, (mm) => {
        store.updateElement(el.id, { repeatGap: Math.max(0, mm) });
        requestRender();
      }),
    ),
  );
  host.appendChild(rGrid);

  host.appendChild(grid);
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
