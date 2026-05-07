import { store } from "../store";
import { A_SIZES } from "../types";
import { DOCUMENT_PRESETS, findPreset } from "../presets";
import { exportBundle, importBundle } from "../bundle";
import { openExportModal } from "./exportModal";
import type { Renderer } from "../webgl/renderer";

// Stroke-based 14×14 SVG icons sized for the topbar toggle cluster.
const SVG = (path: string): string =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICONS = {
  undo: SVG(`<path d="M4 7h7a3 3 0 0 1 0 6H9"/><path d="M7 4L4 7l3 3"/>`),
  redo: SVG(`<path d="M12 7H5a3 3 0 0 0 0 6h2"/><path d="M9 4l3 3-3 3"/>`),
  ruler: SVG(
    `<path d="M2 11l9-9 3 3-9 9z"/><path d="M4.5 8.5l1 1M6.5 6.5l1.5 1.5M8.5 4.5l1 1"/>`,
  ),
  margins: SVG(
    `<rect x="2.5" y="2.5" width="11" height="11" rx="0.5"/><rect x="5" y="5" width="6" height="6" stroke-dasharray="1.5 1.5"/>`,
  ),
  bleed: SVG(
    `<rect x="2.5" y="2.5" width="11" height="11" rx="0.5" stroke-dasharray="1.5 1.5"/><rect x="4.5" y="4.5" width="7" height="7"/>`,
  ),
  grid: SVG(
    `<rect x="2.5" y="2.5" width="11" height="11" rx="0.5"/><path d="M2.5 6.5h11M2.5 9.5h11M6.5 2.5v11M9.5 2.5v11"/>`,
  ),
  snap: SVG(
    `<path d="M3 3l5 5M8 8l5 5"/><path d="M8 5.5v5M5.5 8h5"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/>`,
  ),
};

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

  // --- View menu (preview mode + togglable overlays) ------------------------
  const viewMenu = createMenu({
    label: "View",
    title: "View options & preview",
    icon: "▾",
    build: (panel, close) => {
      panel.appendChild(
        menuToggle(
          "Preview (export view)",
          renderer.previewMode,
          "Hide guides & clip to the trim box, exactly as the PDF would export.",
          (v) => {
            setPreviewMode(v);
            close();
          },
        ),
      );
      panel.appendChild(divider());
      panel.appendChild(
        menuToggle("Rulers", store.prefs.showRulers, "", (v) => {
          store.prefs.showRulers = v;
          store.save();
          document.body.classList.toggle("no-rulers", !v);
          syncToggleButton("rulers", v);
          requestRender();
        }),
      );
      panel.appendChild(
        menuToggle("Margins", store.prefs.showMargins, "", (v) => {
          store.prefs.showMargins = v;
          renderer.showMargins = v;
          store.save();
          syncToggleButton("margins", v);
          requestRender();
        }),
      );
      panel.appendChild(
        menuToggle("Bleed", store.prefs.showBleed, "", (v) => {
          store.prefs.showBleed = v;
          renderer.showBleed = v;
          store.save();
          syncToggleButton("bleed", v);
          requestRender();
        }),
      );
      panel.appendChild(
        menuToggle("Grid", store.prefs.showGrid, "", (v) => {
          store.prefs.showGrid = v;
          renderer.showGrid = v;
          store.save();
          syncToggleButton("grid", v);
          requestRender();
        }),
      );
      panel.appendChild(
        menuToggle("Snap to grid", store.prefs.snapEnabled, "", (v) => {
          store.prefs.snapEnabled = v;
          store.save();
          syncToggleButton("snap", v);
        }),
      );
      panel.appendChild(divider());
      panel.appendChild(
        menuItem("Fit page to screen", () => {
          renderer.fitToScreen();
          requestRender();
          close();
        }),
      );
      panel.appendChild(
        menuItem("Actual size (100%)", () => {
          renderer.view.zoom = 96 / 25.4;
          requestRender();
          close();
        }),
      );
    },
  });
  host.appendChild(viewMenu.el);

  // Track named toggle buttons in the icon cluster so the View menu can keep
  // them visually in sync.
  const toggleButtons = new Map<string, HTMLButtonElement>();
  function syncToggleButton(name: string, on: boolean): void {
    const b = toggleButtons.get(name);
    if (b) b.classList.toggle("on", on);
  }

  // Preview mode escape: any click inside the canvas-host's "exit preview"
  // chrome triggers this. We also expose it on the renderer + ESC key for
  // good measure.
  function setPreviewMode(on: boolean): void {
    renderer.previewMode = on;
    document.body.classList.toggle("preview-mode", on);
    // While previewing, hide rulers chrome regardless of the saved pref so
    // the page is unobscured.
    document.body.classList.toggle("no-rulers", on || !store.prefs.showRulers);
    ensurePreviewBanner(on, () => setPreviewMode(false));
    requestRender();
  }

  // ESC exits preview.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && renderer.previewMode) {
      e.preventDefault();
      setPreviewMode(false);
    }
  });

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

  // --- Undo / Redo ----------------------------------------------------------
  const undoRedo = document.createElement("div");
  undoRedo.className = "tb-cluster";
  const undoBtn = document.createElement("button");
  undoBtn.className = "tb-iconbtn with-icon";
  undoBtn.type = "button";
  undoBtn.title = "Undo (⌘Z)";
  undoBtn.innerHTML = ICONS.undo;
  undoBtn.addEventListener("click", () => {
    store.undo();
    renderer.invalidate();
    requestRender();
  });
  undoRedo.appendChild(undoBtn);
  const redoBtn = document.createElement("button");
  redoBtn.className = "tb-iconbtn with-icon";
  redoBtn.type = "button";
  redoBtn.title = "Redo (⌘⇧Z)";
  redoBtn.innerHTML = ICONS.redo;
  redoBtn.addEventListener("click", () => {
    store.redo();
    renderer.invalidate();
    requestRender();
  });
  undoRedo.appendChild(redoBtn);
  host.appendChild(undoRedo);

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
  const rulersBtn = toggleIconBtn(
    ICONS.ruler,
    "Rulers",
    store.prefs.showRulers,
    (v) => {
      store.prefs.showRulers = v;
      store.save();
      document.body.classList.toggle("no-rulers", !v);
      requestRender();
    },
  );
  toggleButtons.set("rulers", rulersBtn);
  view.appendChild(rulersBtn);
  const marginsBtn = toggleIconBtn(
    ICONS.margins,
    "Margins",
    store.prefs.showMargins,
    (v) => {
      store.prefs.showMargins = v;
      renderer.showMargins = v;
      store.save();
      requestRender();
    },
  );
  toggleButtons.set("margins", marginsBtn);
  view.appendChild(marginsBtn);
  const bleedBtn = toggleIconBtn(
    ICONS.bleed,
    "Bleed",
    store.prefs.showBleed,
    (v) => {
      store.prefs.showBleed = v;
      renderer.showBleed = v;
      store.save();
      requestRender();
    },
  );
  toggleButtons.set("bleed", bleedBtn);
  view.appendChild(bleedBtn);
  const gridBtn = toggleIconBtn(
    ICONS.grid,
    "Grid",
    store.prefs.showGrid,
    (v) => {
      store.prefs.showGrid = v;
      renderer.showGrid = v;
      store.save();
      requestRender();
    },
  );
  toggleButtons.set("grid", gridBtn);
  view.appendChild(gridBtn);
  const snapBtn = toggleIconBtn(
    ICONS.snap,
    "Snap to grid",
    store.prefs.snapEnabled,
    (v) => {
      store.prefs.snapEnabled = v;
      store.save();
    },
  );
  toggleButtons.set("snap", snapBtn);
  view.appendChild(snapBtn);
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
    undoBtn.disabled = !store.canUndo;
    redoBtn.disabled = !store.canRedo;
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

// Toggle row in a popover menu — renders as a checkable item with a check
// glyph on the left when active, plus optional helper text below.
function menuToggle(
  label: string,
  initial: boolean,
  hint: string,
  onChange: (v: boolean) => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "menu-item menu-toggle";
  b.type = "button";
  b.classList.toggle("on", initial);
  b.setAttribute("role", "menuitemcheckbox");
  b.setAttribute("aria-checked", String(initial));
  const check = document.createElement("span");
  check.className = "menu-check";
  check.textContent = "✓";
  const text = document.createElement("span");
  text.className = "menu-toggle-label";
  text.textContent = label;
  b.appendChild(check);
  b.appendChild(text);
  if (hint) {
    const h = document.createElement("span");
    h.className = "menu-hint";
    h.textContent = hint;
    b.appendChild(h);
  }
  b.addEventListener("click", () => {
    const next = !b.classList.contains("on");
    b.classList.toggle("on", next);
    b.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  return b;
}

// Persistent on-canvas banner shown while preview mode is active. Includes
// an "Exit preview" button so users can always get back to editing.
function ensurePreviewBanner(show: boolean, onExit: () => void): void {
  const id = "preview-banner";
  let banner = document.getElementById(id);
  if (!show) {
    banner?.remove();
    return;
  }
  if (banner) return;
  banner = document.createElement("div");
  banner.id = id;
  banner.className = "preview-banner";
  banner.innerHTML = `<span>Preview — showing what will be exported. Press <kbd>Esc</kbd> to exit.</span>`;
  const exit = document.createElement("button");
  exit.type = "button";
  exit.className = "btn small";
  exit.textContent = "Exit preview";
  exit.addEventListener("click", onExit);
  banner.appendChild(exit);
  document.body.appendChild(banner);
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
  glyphOrSvg: string,
  title: string,
  initial: boolean,
  onChange: (v: boolean) => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tb-iconbtn toggle";
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  if (glyphOrSvg.trim().startsWith("<")) {
    b.innerHTML = glyphOrSvg;
    b.classList.add("with-icon");
  } else {
    b.textContent = glyphOrSvg;
  }
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
