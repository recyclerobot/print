import { store } from "../store";
import type { Renderer } from "../webgl/renderer";
import type {
  AnyElement,
  TextElement,
  RectElement,
  ImageElement,
} from "../types";
import { formatUnit, fromUnit, toUnit } from "../units";

export function buildPropertiesPanel(
  host: HTMLElement,
  renderer: Renderer,
  requestRender: () => void,
): void {
  let lastSelKey = "";
  let lastPageId = "";

  const render = (): void => {
    // If the user is currently typing in a control inside this panel and the
    // selection / page hasn't changed, skip the rebuild so focus + caret are
    // preserved. The underlying input handlers already pushed values into the
    // store; the panel doesn't need to be redrawn until the selection changes.
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
    if (
      editingHere &&
      selKey === lastSelKey &&
      pageId === lastPageId &&
      // For text edits driven from the canvas overlay, we still want
      // the textarea value here to reflect the latest store state.
      // The handlers below set values from the store on rebuild.
      true
    ) {
      // Sync the focused textarea value if it represents the selected text
      // element's text — keeps panel and canvas overlay consistent without
      // a full rebuild.
      syncLiveTextarea(host, sel);
      return;
    }
    lastSelKey = selKey;
    lastPageId = pageId;

    host.innerHTML = "";
    // Document properties at top
    documentSection(host, requestRender, renderer);

    if (!sel.length) {
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
    if (el.type === "image") imageSection(host, el, requestRender);
    if (el.type === "image" && (el as ImageElement).gridGroup)
      gridSection(host, el as ImageElement, requestRender);
    layerSection(host, el, requestRender, renderer);
  };
  store.subscribe(render);
  render();
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
  grid.appendChild(
    field(
      "W",
      unitInput(el.width, u, (mm) => {
        store.updateElement(el.id, { width: Math.max(1, mm) });
        requestRender();
      }),
    ),
  );
  grid.appendChild(
    field(
      "H",
      unitInput(el.height, u, (mm) => {
        store.updateElement(el.id, { height: Math.max(1, mm) });
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
  if (el.naturalWidth && el.naturalHeight) {
    const r = document.createElement("div");
    r.className = "readout small";
    r.textContent = `${el.naturalWidth} × ${el.naturalHeight}px`;
    grid.appendChild(field("Source", r));

    // Effective print DPI: source pixels per inch when rendered at the current
    // element size on the page. Use the *fit* dimension that limits resolution.
    const wIn = el.width / 25.4;
    const hIn = el.height / 25.4;
    const dpiW = wIn > 0 ? el.naturalWidth / wIn : 0;
    const dpiH = hIn > 0 ? el.naturalHeight / hIn : 0;
    let dpi = 0;
    if (el.fit === "contain") {
      // Whichever axis is the binding constraint determines actual sampling.
      dpi = Math.min(dpiW, dpiH);
    } else if (el.fit === "cover") {
      dpi = Math.max(dpiW, dpiH);
    } else {
      // 'fill' stretches independently — report the lower of the two.
      dpi = Math.min(dpiW, dpiH);
    }
    const dpiEl = document.createElement("div");
    dpiEl.className = "readout small dpi-readout";
    const rounded = Math.round(dpi);
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
    dpiEl.title = `${label} (${Math.round(dpiW)} × ${Math.round(dpiH)} DPI)`;
    grid.appendChild(field("Print DPI", dpiEl));
  }
  host.appendChild(grid);
}

function gridSection(
  host: HTMLElement,
  el: ImageElement,
  requestRender: () => void,
): void {
  const groupId = el.gridGroup;
  if (!groupId) return;
  const page = store.currentPage;
  if (!page) return;

  const members = page.elements.filter(
    (e) => e.type === "image" && (e as ImageElement).gridGroup === groupId,
  ) as ImageElement[];
  if (members.length < 2) return;

  // Reverse-engineer current grid layout from member positions.
  const xs = [...new Set(members.map((m) => Math.round(m.x * 1000)))].sort(
    (a, b) => a - b,
  );
  const ys = [...new Set(members.map((m) => Math.round(m.y * 1000)))].sort(
    (a, b) => a - b,
  );
  const currentCols = xs.length;
  const currentRows = ys.length;
  const currentFit = members[0].fit;
  let currentGap = 0;
  if (currentCols > 1) {
    const cellW = members[0].width;
    currentGap = (xs[1] - xs[0]) / 1000 - cellW;
    if (currentGap < 0) currentGap = 0;
  } else if (currentRows > 1) {
    const cellH = members[0].height;
    currentGap = (ys[1] - ys[0]) / 1000 - cellH;
    if (currentGap < 0) currentGap = 0;
  }

  sectionTitle(host, "Grid");
  const grid = document.createElement("div");
  grid.className = "grid2";

  const relayout = (
    cols: number,
    rows: number,
    gap: number,
    fit: ImageElement["fit"],
  ) => {
    const total = rows * cols;
    const availW = store.doc.size.width - gap * Math.max(0, cols - 1);
    const availH = store.doc.size.height - gap * Math.max(0, rows - 1);
    if (availW <= 0 || availH <= 0) return;
    const cellW = availW / cols;
    const cellH = availH / rows;

    store.transact(() => {
      // Remove excess members or add clones if needed.
      while (members.length > total) {
        const removed = members.pop()!;
        const idx = page.elements.indexOf(removed);
        if (idx >= 0) page.elements.splice(idx, 1);
      }
      while (members.length < total) {
        const template = members[0];
        const clone: ImageElement = {
          ...JSON.parse(JSON.stringify(template)),
          id: crypto.randomUUID(),
        };
        members.push(clone);
        page.elements.push(clone);
      }
      // Reposition all members.
      for (let i = 0; i < total; i++) {
        const m = members[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        m.x = col * (cellW + gap);
        m.y = row * (cellH + gap);
        m.width = cellW;
        m.height = cellH;
        m.fit = fit;
      }
    });
    requestRender();
  };

  grid.appendChild(
    field(
      "Columns",
      numberInput(currentCols, 1, 50, 1, (v) => {
        const c = Math.max(1, Math.round(v));
        const r = Math.max(1, Math.ceil(members.length / c));
        relayout(c, r, currentGap, currentFit);
      }),
    ),
  );
  grid.appendChild(
    field(
      "Rows",
      numberInput(currentRows, 1, 50, 1, (v) => {
        const r = Math.max(1, Math.round(v));
        const c = Math.max(1, Math.ceil(members.length / r));
        relayout(c, r, currentGap, currentFit);
      }),
    ),
  );
  const u = store.prefs.unit;
  grid.appendChild(
    field(
      "Gap",
      unitInput(currentGap, u, (mm) => {
        relayout(currentCols, currentRows, Math.max(0, mm), currentFit);
      }),
    ),
  );
  const fitSel = select(["contain", "cover", "fill"], (v) => {
    relayout(currentCols, currentRows, currentGap, v as ImageElement["fit"]);
  });
  fitSel.value = currentFit;
  grid.appendChild(field("Fit", fitSel));

  host.appendChild(grid);
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
