import { store } from "../store";
import { A_SIZES } from "../types";
import { DOCUMENT_PRESETS, findPreset } from "../presets";
import { exportBundle, importBundle } from "../bundle";
import { openExportModal } from "./exportModal";
import type { Renderer } from "../webgl/renderer";

export function buildToolbar(
  host: HTMLElement,
  renderer: Renderer,
  requestRender: () => void,
): void {
  host.innerHTML = "";
  host.classList.add("topbar-v2");

  // --- Brand / app title -----------------------------------------------------
  const brand = document.createElement("div");
  brand.className = "tb-brand";
  brand.textContent = "Print";
  host.appendChild(brand);

  // --- Project menu ----------------------------------------------------------
  const projectMenu = createMenu({
    getLabel: () => store.doc.name || "Untitled",
    title: "Project",
    icon: "▾",
    build: (panel, close) => {
      const list = document.createElement("div");
      list.className = "menu-list";
      const projects = store.listProjects();
      for (const p of projects) {
        const row = document.createElement("div");
        row.className = "menu-row";
        if (p.id === store.currentProjectId) row.classList.add("active");

        const main = document.createElement("button");
        main.className = "menu-row-main";
        main.type = "button";
        const name = document.createElement("span");
        name.className = "menu-row-name";
        name.textContent = p.name || "Untitled";
        const time = document.createElement("span");
        time.className = "menu-row-time";
        time.textContent = formatRelative(p.updatedAt);
        main.appendChild(name);
        main.appendChild(time);
        main.addEventListener("click", () => {
          if (p.id !== store.currentProjectId) {
            store.switchProject(p.id);
            renderer.invalidate();
            renderer.fitToScreen();
            requestRender();
          }
          close();
        });
        row.appendChild(main);

        const actions = document.createElement("div");
        actions.className = "menu-row-actions";
        actions.appendChild(
          iconBtn("✎", "Rename", () => {
            const next = prompt("Rename project:", p.name);
            if (next == null) return;
            const v = next.trim();
            if (!v) return;
            store.renameProject(p.id, v);
          }),
        );
        actions.appendChild(
          iconBtn("⧉", "Duplicate", () => {
            store.duplicateProject(p.id);
          }),
        );
        const delBtn = iconBtn("×", "Delete", () => {
          if (!confirm(`Delete project "${p.name}"? This cannot be undone.`))
            return;
          store.deleteProject(p.id);
          renderer.invalidate();
          renderer.fitToScreen();
          requestRender();
        });
        delBtn.classList.add("danger");
        actions.appendChild(delBtn);
        row.appendChild(actions);

        list.appendChild(row);
      }
      panel.appendChild(list);
      panel.appendChild(divider());
      panel.appendChild(
        menuItem("＋  New project…", () => {
          const name = prompt("Name for the new project:", "Untitled Document");
          if (name == null) return;
          store.createProject(name.trim() || "Untitled Document");
          renderer.invalidate();
          renderer.fitToScreen();
          requestRender();
          close();
        }),
      );
    },
  });
  host.appendChild(projectMenu.el);

  // --- File menu ------------------------------------------------------------
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = ".zip,application/zip";
  importInput.style.display = "none";
  importInput.addEventListener("change", async () => {
    const f = importInput.files?.[0];
    if (!f) return;
    if (
      !confirm(
        "Importing will replace the current project's contents. Continue?",
      )
    ) {
      importInput.value = "";
      return;
    }
    try {
      const doc = await importBundle(f);
      store.loadDocument(doc);
      renderer.invalidate();
      renderer.fitToScreen();
      requestRender();
    } catch (e) {
      alert("Import failed: " + (e as Error).message);
    } finally {
      importInput.value = "";
    }
  });
  host.appendChild(importInput);

  const fileMenu = createMenu({
    label: "File",
    title: "File actions",
    icon: "▾",
    build: (panel, close) => {
      panel.appendChild(
        menuItem("Clear current document", () => {
          if (!confirm("Discard current document and start fresh?")) return;
          store.resetDocument();
          renderer.invalidate();
          requestRender();
          close();
        }),
      );
      panel.appendChild(divider());
      panel.appendChild(
        menuItem("Import bundle…", () => {
          importInput.click();
          close();
        }),
      );
      panel.appendChild(
        menuItem("Export bundle (.zip)", async () => {
          close();
          try {
            const blob = await exportBundle(store.doc);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const safe = (store.doc.name || "document").replace(
              /[^a-z0-9-_ ]/gi,
              "_",
            );
            a.href = url;
            a.download = `${safe}.printbundle.zip`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            alert("Export failed: " + (e as Error).message);
          }
        }),
      );
      panel.appendChild(divider());
      panel.appendChild(
        menuItem("Print preview…", () => {
          openPrintPreview();
          close();
        }),
      );
    },
  });
  host.appendChild(fileMenu.el);

  // --- Document menu (size preset, document preset, custom W/H) -------------
  const docMenu = createMenu({
    label: "Document",
    title: "Page size & presets",
    icon: "▾",
    build: (panel) => {
      const grid = document.createElement("div");
      grid.className = "menu-grid";

      const sizeSel = select(Object.keys(A_SIZES), (v) => {
        const s = A_SIZES[v];
        store.setDocumentMeta({ size: { ...s } });
        renderer.fitToScreen();
        requestRender();
      });
      for (const [name, s] of Object.entries(A_SIZES)) {
        if (
          Math.abs(s.width - store.doc.size.width) < 0.5 &&
          Math.abs(s.height - store.doc.size.height) < 0.5
        ) {
          sizeSel.value = name;
          break;
        }
      }
      grid.appendChild(menuField("Size", sizeSel));

      const tplSel = select(
        ["— select —", ...DOCUMENT_PRESETS.map((p) => p.name)],
        () => {
          /* applied via Apply button */
        },
      );
      for (const p of DOCUMENT_PRESETS) {
        if (
          Math.abs(p.size.width - store.doc.size.width) < 0.5 &&
          Math.abs(p.size.height - store.doc.size.height) < 0.5 &&
          Math.abs(p.bleed.top - store.doc.bleed.top) < 0.1 &&
          Math.abs(p.margins.top - store.doc.margins.top) < 0.1
        ) {
          tplSel.value = p.name;
          break;
        }
      }
      grid.appendChild(menuField("Preset", tplSel));

      const wIn = numInput(store.doc.size.width / 10, 0.1, 200, 0.1, (v) => {
        store.setDocumentMeta({ size: { ...store.doc.size, width: v * 10 } });
        renderer.fitToScreen();
        requestRender();
      });
      const hIn = numInput(store.doc.size.height / 10, 0.1, 200, 0.1, (v) => {
        store.setDocumentMeta({ size: { ...store.doc.size, height: v * 10 } });
        renderer.fitToScreen();
        requestRender();
      });
      grid.appendChild(menuField("W (cm)", wIn));
      grid.appendChild(menuField("H (cm)", hIn));

      panel.appendChild(grid);

      const applyBtn = document.createElement("button");
      applyBtn.className = "btn primary menu-apply";
      applyBtn.type = "button";
      applyBtn.textContent = "Apply preset";
      applyBtn.addEventListener("click", () => {
        const preset =
          DOCUMENT_PRESETS.find((p) => p.name === tplSel.value) ??
          findPreset(tplSel.value);
        if (!preset) return;
        store.setDocumentMeta({
          size: { ...preset.size },
          bleed: { ...preset.bleed },
          margins: { ...preset.margins },
        });
        for (const [name, s] of Object.entries(A_SIZES)) {
          if (
            Math.abs(s.width - preset.size.width) < 0.5 &&
            Math.abs(s.height - preset.size.height) < 0.5
          ) {
            sizeSel.value = name;
            break;
          }
        }
        renderer.fitToScreen();
        requestRender();
      });
      panel.appendChild(applyBtn);
    },
  });
  host.appendChild(docMenu.el);

  // --- Spacer pushes view controls to the right -----------------------------
  const spacer = document.createElement("div");
  spacer.className = "tb-spacer";
  host.appendChild(spacer);

  // --- Saved indicator ------------------------------------------------------
  const savedIndicator = document.createElement("div");
  savedIndicator.className = "tb-saved";
  savedIndicator.title = "Autosaved locally";
  savedIndicator.innerHTML = `<span class="tb-saved-dot"></span><span class="tb-saved-text">Saved</span>`;
  host.appendChild(savedIndicator);

  // --- Zoom group -----------------------------------------------------------
  const zoom = document.createElement("div");
  zoom.className = "tb-cluster";
  zoom.appendChild(
    iconTextBtn("Fit", "Fit page to screen", () => {
      renderer.fitToScreen();
      requestRender();
    }),
  );
  zoom.appendChild(
    iconTextBtn("100%", "Actual size (100%)", () => {
      renderer.view.zoom = 96 / 25.4;
      requestRender();
    }),
  );
  host.appendChild(zoom);

  // --- View toggles (compact icon buttons with tooltips) --------------------
  const view = document.createElement("div");
  view.className = "tb-cluster";
  view.appendChild(
    toggleIconBtn("R", "Rulers", store.prefs.showRulers, (v) => {
      store.prefs.showRulers = v;
      store.save();
      document.body.classList.toggle("no-rulers", !v);
      requestRender();
    }),
  );
  view.appendChild(
    toggleIconBtn("M", "Margins", store.prefs.showMargins, (v) => {
      store.prefs.showMargins = v;
      renderer.showMargins = v;
      store.save();
      requestRender();
    }),
  );
  view.appendChild(
    toggleIconBtn("B", "Bleed", store.prefs.showBleed, (v) => {
      store.prefs.showBleed = v;
      renderer.showBleed = v;
      store.save();
      requestRender();
    }),
  );
  view.appendChild(
    toggleIconBtn("G", "Grid", store.prefs.showGrid, (v) => {
      store.prefs.showGrid = v;
      renderer.showGrid = v;
      store.save();
      requestRender();
    }),
  );
  view.appendChild(
    toggleIconBtn("S", "Snap to grid", store.prefs.snapEnabled, (v) => {
      store.prefs.snapEnabled = v;
      store.save();
    }),
  );
  host.appendChild(view);

  // --- Export PDF as primary CTA -------------------------------------------
  const exportPdf = document.createElement("button");
  exportPdf.className = "btn primary";
  exportPdf.type = "button";
  exportPdf.textContent = "Export PDF";
  exportPdf.title = "Export the document as a print-ready PDF";
  exportPdf.addEventListener("click", () => openExportModal());
  host.appendChild(exportPdf);

  // --- Refresh menu labels and saved indicator on store changes -------------
  let savedTimer: number | null = null;
  const refresh = (): void => {
    projectMenu.refreshLabel();
    const txt = savedIndicator.querySelector(".tb-saved-text") as HTMLElement;
    savedIndicator.classList.add("dirty");
    txt.textContent = "Saving…";
    if (savedTimer != null) window.clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => {
      savedIndicator.classList.remove("dirty");
      txt.textContent = "Saved";
    }, 350);
  };
  store.subscribe(refresh);
}

// =============================================================================
// Menu / popover helpers
// =============================================================================

interface MenuOptions {
  label?: string;
  getLabel?: () => string;
  title: string;
  icon?: string;
  build: (panel: HTMLElement, close: () => void) => void;
}

interface MenuHandle {
  el: HTMLButtonElement;
  refreshLabel: () => void;
}

function createMenu(opts: MenuOptions): MenuHandle {
  const btn = document.createElement("button");
  btn.className = "tb-menu-btn";
  btn.title = opts.title;
  btn.type = "button";

  const labelEl = document.createElement("span");
  labelEl.className = "tb-menu-label";
  const setLabel = (): void => {
    labelEl.textContent = opts.getLabel ? opts.getLabel() : (opts.label ?? "");
  };
  setLabel();
  btn.appendChild(labelEl);

  if (opts.icon) {
    const caret = document.createElement("span");
    caret.className = "tb-menu-caret";
    caret.textContent = opts.icon;
    btn.appendChild(caret);
  }

  let panel: HTMLDivElement | null = null;

  const onDocDown = (e: MouseEvent): void => {
    if (!panel) return;
    const t = e.target as Node;
    if (panel.contains(t) || btn.contains(t)) return;
    close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };

  function close(): void {
    if (!panel) return;
    panel.remove();
    panel = null;
    btn.classList.remove("open");
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("keydown", onKey, true);
  }

  function open(): void {
    panel = document.createElement("div");
    panel.className = "tb-popover";
    opts.build(panel, close);
    document.body.appendChild(panel);
    const r = btn.getBoundingClientRect();
    panel.style.left = `${Math.round(r.left)}px`;
    panel.style.top = `${Math.round(r.bottom + 4)}px`;
    requestAnimationFrame(() => {
      if (!panel) return;
      const pr = panel.getBoundingClientRect();
      const overflow = pr.right - window.innerWidth + 8;
      if (overflow > 0) panel.style.left = `${Math.round(r.left - overflow)}px`;
    });
    btn.classList.add("open");
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey, true);
  }

  btn.addEventListener("click", () => {
    if (panel) close();
    else open();
  });

  return { el: btn, refreshLabel: setLabel };
}

function menuItem(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "menu-item";
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function divider(): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "menu-sep";
  return d;
}

function menuField(label: string, control: HTMLElement): HTMLElement {
  const w = document.createElement("label");
  w.className = "menu-field";
  const s = document.createElement("span");
  s.textContent = label;
  w.appendChild(s);
  w.appendChild(control);
  return w;
}

function iconBtn(
  glyph: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "menu-icon-btn";
  b.type = "button";
  b.title = title;
  b.textContent = glyph;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function iconTextBtn(
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tb-iconbtn";
  b.type = "button";
  b.title = title;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function toggleIconBtn(
  label: string,
  title: string,
  initial: boolean,
  onChange: (v: boolean) => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tb-iconbtn toggle";
  b.type = "button";
  b.title = title;
  b.textContent = label;
  b.classList.toggle("on", initial);
  b.addEventListener("click", () => {
    const next = !b.classList.contains("on");
    b.classList.toggle("on", next);
    onChange(next);
  });
  return b;
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

function numInput(
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
  i.addEventListener("change", () => onChange(parseFloat(i.value)));
  return i;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// =============================================================================
// Print preview window
// =============================================================================

function openPrintPreview(): void {
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) return;
  const doc = store.doc;
  const styles = `
    body { margin: 0; background: #555; padding: 20px; font-family: system-ui, sans-serif; color: #eee; }
    h1 { font-size: 14px; margin: 0 0 10px; }
    .page { background: white; box-shadow: 0 4px 30px rgba(0,0,0,.5); margin: 0 auto 20px; }
    @media print {
      body { background: white; padding: 0; }
      .page { box-shadow: none; margin: 0; page-break-after: always; }
      h1, .toolbar { display: none; }
    }
    .toolbar { text-align: center; margin-bottom: 20px; }
    .toolbar button { padding: 8px 14px; font-size: 14px; cursor: pointer; }
  `;
  let body = `<div class="toolbar"><button onclick="window.print()">Print</button></div>`;
  for (let i = 0; i < doc.pages.length; i++) {
    body += `<h1>Page ${i + 1}</h1><canvas class="page" id="p${i}"></canvas>`;
  }
  win.document.write(
    `<!doctype html><html><head><title>Preview – ${doc.name}</title><style>${styles}</style></head><body>${body}</body></html>`,
  );
  win.document.close();
  setTimeout(async () => {
    const { exportPagePreview } = await import("../printPreview");
    for (let i = 0; i < doc.pages.length; i++) {
      const c = win.document.getElementById(
        "p" + i,
      ) as HTMLCanvasElement | null;
      if (c) await exportPagePreview(doc, doc.pages[i], c, 150);
    }
  }, 50);
}
