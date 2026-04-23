import { store } from "../store";
import {
  exportPdf,
  DEFAULT_EXPORT_OPTIONS,
  type ExportOptions,
  type ExportDpi,
  type ExportSizeMode,
  type ExportImageFormat,
} from "../pdf";

const PREFS_KEY = "print.exportOptions.v1";

function loadPrefs(): ExportOptions {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_EXPORT_OPTIONS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_EXPORT_OPTIONS };
}

function savePrefs(opts: ExportOptions): void {
  // Don't persist transient fields like custom page selection.
  const { pages: _pages, ...rest } = opts;
  void _pages;
  localStorage.setItem(PREFS_KEY, JSON.stringify(rest));
}

export function openExportModal(): void {
  const opts = loadPrefs();
  // Page range UI state is local to this modal session.
  type PageRange = "all" | "current" | "custom";
  let pageRange: PageRange = "all";
  let customRange = "";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const modal = document.createElement("div");
  modal.className = "modal";
  overlay.appendChild(modal);

  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `<h2>Export PDF</h2>`;
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn icon";
  closeBtn.textContent = "×";
  closeBtn.title = "Close";
  closeBtn.addEventListener("click", close);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body";
  modal.appendChild(body);

  // --- Size mode (Bruto / Netto) ---
  body.appendChild(sectionTitle("Page size"));
  const sizeRow = radioGroup(
    [
      { value: "bruto", label: "Bruto (trim + bleed)" },
      { value: "netto", label: "Netto (trim only)" },
    ],
    opts.sizeMode,
    (v) => {
      opts.sizeMode = v as ExportSizeMode;
      updateSummary();
      // Crop/registration marks only make sense with bleed.
      cropChk.disabled = registrationChk.disabled = opts.sizeMode !== "bruto";
    },
  );
  body.appendChild(sizeRow);

  // --- DPI ---
  body.appendChild(sectionTitle("Resolution"));
  const dpiRow = radioGroup(
    [
      { value: "72", label: "72 (screen)" },
      { value: "150", label: "150 (draft)" },
      { value: "300", label: "300 (print)" },
      { value: "600", label: "600 (high)" },
      { value: "1200", label: "1200 (max)" },
    ],
    String(opts.dpi),
    (v) => {
      opts.dpi = parseInt(v, 10) as ExportDpi;
      updateSummary();
    },
  );
  body.appendChild(dpiRow);

  // --- Marks ---
  body.appendChild(sectionTitle("Printer marks"));
  const cropChk = checkbox(
    "Crop / cut marks",
    opts.cropMarks,
    (v) => {
      opts.cropMarks = v;
    },
  );
  const registrationChk = checkbox(
    "Registration marks",
    opts.registrationMarks,
    (v) => {
      opts.registrationMarks = v;
    },
  );
  cropChk.disabled = registrationChk.disabled = opts.sizeMode !== "bruto";
  body.appendChild(cropChk.parentElement!);
  body.appendChild(registrationChk.parentElement!);

  // --- Image format / quality ---
  body.appendChild(sectionTitle("Image format"));
  const fmtRow = radioGroup(
    [
      { value: "jpeg", label: "JPEG (smaller)" },
      { value: "png", label: "PNG (lossless)" },
    ],
    opts.imageFormat,
    (v) => {
      opts.imageFormat = v as ExportImageFormat;
      qInput.disabled = qSlider.disabled = opts.imageFormat === "png";
    },
  );
  body.appendChild(fmtRow);

  const qSlider = document.createElement("input");
  qSlider.type = "range";
  qSlider.min = "0.4";
  qSlider.max = "1";
  qSlider.step = "0.01";
  qSlider.value = String(opts.jpegQuality);
  const qInput = document.createElement("input");
  qInput.type = "number";
  qInput.min = "0.4";
  qInput.max = "1";
  qInput.step = "0.01";
  qInput.value = opts.jpegQuality.toFixed(2);
  qInput.className = "num";
  qSlider.addEventListener("input", () => {
    opts.jpegQuality = parseFloat(qSlider.value);
    qInput.value = opts.jpegQuality.toFixed(2);
  });
  qInput.addEventListener("change", () => {
    opts.jpegQuality = Math.max(0.4, Math.min(1, parseFloat(qInput.value)));
    qSlider.value = String(opts.jpegQuality);
  });
  qSlider.disabled = qInput.disabled = opts.imageFormat === "png";
  const qRow = document.createElement("div");
  qRow.className = "modal-quality";
  const qLabel = document.createElement("label");
  qLabel.textContent = "JPEG quality";
  qRow.appendChild(qLabel);
  qRow.appendChild(qSlider);
  qRow.appendChild(qInput);
  body.appendChild(qRow);

  // --- Background ---
  body.appendChild(sectionTitle("Background (bleed area)"));
  const bgRow = document.createElement("div");
  bgRow.className = "modal-row";
  const bgColor = document.createElement("input");
  bgColor.type = "color";
  bgColor.value = opts.background;
  bgColor.addEventListener("input", () => {
    opts.background = bgColor.value;
  });
  bgRow.appendChild(bgColor);
  const bgWhite = document.createElement("button");
  bgWhite.className = "btn small";
  bgWhite.textContent = "White";
  bgWhite.addEventListener("click", () => {
    opts.background = "#ffffff";
    bgColor.value = "#ffffff";
  });
  bgRow.appendChild(bgWhite);
  body.appendChild(bgRow);

  // --- Pages ---
  body.appendChild(sectionTitle("Pages"));
  const total = store.doc.pages.length;
  const pagesRow = radioGroup(
    [
      { value: "all", label: `All (${total})` },
      { value: "current", label: "Current page" },
      { value: "custom", label: "Custom range" },
    ],
    pageRange,
    (v) => {
      pageRange = v as PageRange;
      customInput.disabled = pageRange !== "custom";
    },
  );
  body.appendChild(pagesRow);
  const customInput = document.createElement("input");
  customInput.type = "text";
  customInput.placeholder = "e.g. 1-3, 5, 8-";
  customInput.value = customRange;
  customInput.disabled = (pageRange as string) !== "custom";
  customInput.addEventListener("input", () => {
    customRange = customInput.value;
  });
  body.appendChild(customInput);

  // --- Summary ---
  const summary = document.createElement("div");
  summary.className = "modal-summary";
  body.appendChild(summary);
  function updateSummary(): void {
    const includeBleed = opts.sizeMode === "bruto";
    const w =
      store.doc.size.width +
      (includeBleed ? store.doc.bleed.left + store.doc.bleed.right : 0);
    const h =
      store.doc.size.height +
      (includeBleed ? store.doc.bleed.top + store.doc.bleed.bottom : 0);
    const pxW = Math.round((w / 25.4) * opts.dpi);
    const pxH = Math.round((h / 25.4) * opts.dpi);
    summary.innerHTML =
      `<strong>${w.toFixed(1)} × ${h.toFixed(1)} mm</strong> · ` +
      `${pxW} × ${pxH} px @ ${opts.dpi} DPI`;
  }
  updateSummary();

  // --- Footer ---
  const footer = document.createElement("div");
  footer.className = "modal-footer";
  modal.appendChild(footer);
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", close);
  footer.appendChild(cancel);
  const exportBtn = document.createElement("button");
  exportBtn.className = "btn primary";
  exportBtn.textContent = "Export";
  exportBtn.addEventListener("click", async () => {
    const range = resolvePages(pageRange, customRange, total);
    if (!range.length) {
      alert("Page range is empty.");
      return;
    }
    const finalOpts: ExportOptions = { ...opts, pages: range };
    savePrefs(finalOpts);
    exportBtn.disabled = cancel.disabled = true;
    exportBtn.textContent = "Exporting…";
    try {
      const blob = await exportPdf(store.doc, finalOpts);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const name = (store.doc.name || "document").replace(
        /[^a-z0-9-_ ]/gi,
        "_",
      );
      a.href = url;
      a.download = `${name}-${opts.sizeMode}-${opts.dpi}dpi.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      close();
    } catch (e) {
      alert("Export failed: " + (e as Error).message);
      exportBtn.disabled = cancel.disabled = false;
      exportBtn.textContent = "Export";
    }
  });
  footer.appendChild(exportBtn);

  document.body.appendChild(overlay);
  // Trap escape
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);

  function close(): void {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }
}

function resolvePages(
  mode: "all" | "current" | "custom",
  custom: string,
  total: number,
): number[] {
  if (mode === "all") return Array.from({ length: total }, (_, i) => i + 1);
  if (mode === "current") {
    const idx = store.doc.pages.findIndex((p) => p.id === store.currentPageId);
    return idx >= 0 ? [idx + 1] : [];
  }
  const set = new Set<number>();
  for (const part of custom.split(",")) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d*)$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : total;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
        if (i >= 1 && i <= total) set.add(i);
      }
    } else {
      const n = parseInt(part.trim(), 10);
      if (!Number.isNaN(n) && n >= 1 && n <= total) set.add(n);
    }
  }
  return [...set].sort((a, b) => a - b);
}

function sectionTitle(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "modal-section-title";
  el.textContent = text;
  return el;
}

function radioGroup(
  options: Array<{ value: string; label: string }>,
  current: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "modal-radio-group";
  const name = `rg_${Math.random().toString(36).slice(2, 8)}`;
  for (const o of options) {
    const lbl = document.createElement("label");
    lbl.className = "modal-radio";
    const r = document.createElement("input");
    r.type = "radio";
    r.name = name;
    r.value = o.value;
    r.checked = o.value === current;
    r.addEventListener("change", () => {
      if (r.checked) onChange(o.value);
    });
    lbl.appendChild(r);
    const span = document.createElement("span");
    span.textContent = o.label;
    lbl.appendChild(span);
    wrap.appendChild(lbl);
  }
  return wrap;
}

function checkbox(
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): HTMLInputElement {
  const lbl = document.createElement("label");
  lbl.className = "modal-checkbox";
  const c = document.createElement("input");
  c.type = "checkbox";
  c.checked = checked;
  c.addEventListener("change", () => onChange(c.checked));
  lbl.appendChild(c);
  const span = document.createElement("span");
  span.textContent = label;
  lbl.appendChild(span);
  return c;
}
