import { store } from "../store";
import { exportPdf, type ExportDpi } from "../pdf";
import { newImageElement, newRectElement, newTextElement } from "../store";
import { A_SIZES } from "../types";
import { DOCUMENT_PRESETS, findPreset } from "../presets";
import { exportBundle, importBundle } from "../bundle";
import type { Renderer } from "../webgl/renderer";

export function buildToolbar(
  host: HTMLElement,
  renderer: Renderer,
  requestRender: () => void,
): void {
  host.innerHTML = "";

  const group = (label: string) => {
    const g = document.createElement("div");
    g.className = "tb-group";
    if (label) {
      const l = document.createElement("span");
      l.className = "tb-label";
      l.textContent = label;
      g.appendChild(l);
    }
    host.appendChild(g);
    return g;
  };

  // File group
  const file = group("");
  file.appendChild(
    button("New", () => {
      if (!confirm("Discard current document and start fresh?")) return;
      store.resetDocument();
      renderer.invalidate();
      requestRender();
    }),
  );
  file.appendChild(
    button("Export", async () => {
      try {
        const blob = await exportBundle(store.doc);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const safe = (store.doc.name || "document").replace(/[^a-z0-9-_ ]/gi, "_");
        a.href = url;
        a.download = `${safe}.printbundle.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        alert("Export failed: " + (e as Error).message);
      }
    }),
  );
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = ".zip,application/zip";
  importInput.style.display = "none";
  importInput.addEventListener("change", async () => {
    const f = importInput.files?.[0];
    if (!f) return;
    if (
      !confirm(
        "Importing will replace the current document. Continue?",
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
  file.appendChild(importInput);
  file.appendChild(button("Import", () => importInput.click()));
  const sizeSel = select(Object.keys(A_SIZES), (v) => {
    const s = A_SIZES[v];
    store.setDocumentMeta({ size: { ...s } });
    renderer.fitToScreen();
    requestRender();
  });
  // Match current size to a preset name when possible
  for (const [name, s] of Object.entries(A_SIZES)) {
    if (
      Math.abs(s.width - store.doc.size.width) < 0.5 &&
      Math.abs(s.height - store.doc.size.height) < 0.5
    ) {
      sizeSel.value = name;
      break;
    }
  }
  file.appendChild(labeledControl("Preset", sizeSel));

  // Default templates: full document presets (size + bleed + safety zone).
  const tplSel = select(
    ["— select —", ...DOCUMENT_PRESETS.map((p) => p.name)],
    () => {
      /* applied by Apply button */
    },
  );
  tplSel.title = "Built-in document presets";
  // Reflect current document if it matches a preset.
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
  file.appendChild(labeledControl("Template", tplSel));
  file.appendChild(
    button("Apply", () => {
      const preset =
        DOCUMENT_PRESETS.find((p) => p.name === tplSel.value) ??
        findPreset(tplSel.value);
      if (!preset) return;
      store.setDocumentMeta({
        size: { ...preset.size },
        bleed: { ...preset.bleed },
        margins: { ...preset.margins },
      });
      // Sync the size preset dropdown if the new size matches one.
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
    }),
  );

  // Custom size
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
  file.appendChild(labeledControl("W (cm)", wIn));
  file.appendChild(labeledControl("H (cm)", hIn));

  // Insert group
  const insert = group("Insert");
  insert.appendChild(
    button("+ Text", () => {
      store.addElement(newTextElement({ x: 20, y: 20, width: 80, height: 30 }));
      requestRender();
    }),
  );
  insert.appendChild(
    button("+ Rect", () => {
      store.addElement(newRectElement());
      requestRender();
    }),
  );
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const ratio = img.naturalWidth / img.naturalHeight;
        const w = 80,
          h = w / ratio;
        store.addElement(
          newImageElement({
            src,
            x: 20,
            y: 20,
            width: w,
            height: h,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          }),
        );
        requestRender();
      };
      img.src = src;
    };
    reader.readAsDataURL(f);
    fileInput.value = "";
  });
  insert.appendChild(fileInput);
  insert.appendChild(button("+ Image", () => fileInput.click()));

  // View group
  const view = group("View");
  view.appendChild(
    button("Fit", () => {
      renderer.fitToScreen();
      requestRender();
    }),
  );
  view.appendChild(
    button("100%", () => {
      // 100% = 1mm-on-screen-equals-1mm-on-paper at 96 DPI ≈ 3.78 px/mm
      renderer.view.zoom = 96 / 25.4;
      requestRender();
    }),
  );
  view.appendChild(
    toggleBtn("Rulers", store.prefs.showRulers, (v) => {
      store.prefs.showRulers = v;
      store.save();
      document.body.classList.toggle("no-rulers", !v);
      requestRender();
    }),
  );
  view.appendChild(
    toggleBtn("Margins", store.prefs.showMargins, (v) => {
      store.prefs.showMargins = v;
      renderer.showMargins = v;
      store.save();
      requestRender();
    }),
  );
  view.appendChild(
    toggleBtn("Bleed", store.prefs.showBleed, (v) => {
      store.prefs.showBleed = v;
      renderer.showBleed = v;
      store.save();
      requestRender();
    }),
  );
  view.appendChild(
    toggleBtn("Grid", store.prefs.showGrid, (v) => {
      store.prefs.showGrid = v;
      renderer.showGrid = v;
      store.save();
      requestRender();
    }),
  );
  view.appendChild(
    toggleBtn("Snap", store.prefs.snapEnabled, (v) => {
      store.prefs.snapEnabled = v;
      store.save();
    }),
  );

  // Print preview & export
  const out = group("Output");
  out.appendChild(button("Print Preview", () => openPrintPreview()));
  const dpiSel = select(["72", "150", "300", "600", "1200"], () => {});
  dpiSel.value = "300";
  out.appendChild(labeledControl("DPI", dpiSel));
  out
    .appendChild(
      button("Export PDF", async () => {
        const dpi = parseInt(dpiSel.value, 10) as ExportDpi;
        const btn = host.querySelector(
          "[data-export]",
        ) as HTMLButtonElement | null;
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Exporting…";
        }
        try {
          const blob = await exportPdf(store.doc, {
            dpi,
            includeBleed: true,
            includeCropMarks: true,
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${store.doc.name || "document"}-${dpi}dpi.pdf`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) {
          alert("Export failed: " + (e as Error).message);
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Export PDF";
          }
        }
      }),
    )
    .setAttribute("data-export", "1");
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
function toggleBtn(
  label: string,
  initial: boolean,
  onChange: (v: boolean) => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "btn toggle";
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
function labeledControl(label: string, control: HTMLElement): HTMLElement {
  const w = document.createElement("label");
  w.className = "lc";
  const s = document.createElement("span");
  s.textContent = label;
  w.appendChild(s);
  w.appendChild(control);
  return w;
}

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
  // Render after a tick so canvases exist
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
