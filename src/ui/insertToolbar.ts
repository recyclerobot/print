import { store } from "../store";
import { newImageElement, newRectElement, newTextElement } from "../store";
import { prepareImportedImage } from "../imageImport";
import type { ImageElement } from "../types";

// Vertical "Insert" rail on the far left. Mirrors the buttons that previously
// lived in the top toolbar's "Insert" group.
export function buildInsertToolbar(
  host: HTMLElement,
  requestRender: () => void,
): void {
  host.innerHTML = "";

  host.appendChild(
    railButton("T", "Add text", () => {
      store.addElement(newTextElement({ x: 20, y: 20, width: 80, height: 30 }));
      requestRender();
    }),
  );

  host.appendChild(
    railButton("▭", "Add shape", () => {
      store.addElement(newRectElement());
      requestRender();
    }),
  );

  // Hidden file picker for image insertion.
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (!f) return;
    try {
      const prepared = await prepareImportedImage(f);
      // Default place: 80mm wide, preserving aspect ratio.
      const w = 80;
      const h = w / (prepared.naturalWidth / prepared.naturalHeight);
      store.addElement(
        newImageElement({
          src: prepared.dataUrl,
          x: 20,
          y: 20,
          width: w,
          height: h,
          naturalWidth: prepared.naturalWidth,
          naturalHeight: prepared.naturalHeight,
        }),
      );
      requestRender();
    } catch (e) {
      const msg = (e as Error).message || String(e);
      alert(msg);
    }
  });
  host.appendChild(fileInput);
  host.appendChild(railButton("🖼", "Add image", () => fileInput.click()));

  // Hidden file picker for image grid insertion.
  const gridInput = document.createElement("input");
  gridInput.type = "file";
  gridInput.accept = "image/*";
  gridInput.multiple = true;
  gridInput.style.display = "none";
  gridInput.addEventListener("change", async () => {
    const files = Array.from(gridInput.files ?? []);
    gridInput.value = "";
    if (!files.length) return;

    const page = store.currentPage;
    if (!page) return;

    const count = files.length;
    const suggestedCols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const suggestedRows = Math.max(1, Math.ceil(count / suggestedCols));
    const cols = askPositiveInt("Grid columns:", suggestedCols);
    if (cols == null) return;
    const rows = askPositiveInt("Grid rows:", suggestedRows);
    if (rows == null) return;
    const gap = askNonNegativeNumber("Gap between cells (mm):", 0);
    if (gap == null) return;
    const fit = askFitMode("Cell fit mode (cover, contain, fill):", "cover");
    if (!fit) return;

    const availW = store.doc.size.width - gap * (cols - 1);
    const availH = store.doc.size.height - gap * (rows - 1);
    if (availW <= 0 || availH <= 0) {
      alert("Grid/gap is too large for this page size.");
      return;
    }
    const cellW = availW / cols;
    const cellH = availH / rows;

    try {
      const prepared = await Promise.all(
        files.map((f) => prepareImportedImage(f)),
      );
      const created: ImageElement[] = [];
      const total = rows * cols;
      for (let i = 0; i < total; i++) {
        const src = prepared[i % prepared.length];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * (cellW + gap);
        const y = row * (cellH + gap);
        created.push(
          newImageElement({
            src: src.dataUrl,
            x,
            y,
            width: cellW,
            height: cellH,
            fit,
            naturalWidth: src.naturalWidth,
            naturalHeight: src.naturalHeight,
          }),
        );
      }

      store.transact(() => {
        page.elements.push(...created);
      });
      store.setSelection(created.map((e) => e.id));
      requestRender();
    } catch (e) {
      const msg = (e as Error).message || String(e);
      alert(msg);
    }
  });
  host.appendChild(gridInput);
  host.appendChild(railButton("▦", "Add image grid", () => gridInput.click()));
}

function askPositiveInt(promptText: string, initial: number): number | null {
  const raw = prompt(promptText, String(initial));
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    alert("Please enter a whole number >= 1.");
    return null;
  }
  return n;
}

function askNonNegativeNumber(
  promptText: string,
  initial: number,
): number | null {
  const raw = prompt(promptText, String(initial));
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    alert("Please enter a number >= 0.");
    return null;
  }
  return n;
}

function askFitMode(
  promptText: string,
  initial: ImageElement["fit"],
): ImageElement["fit"] | null {
  const raw = prompt(promptText, initial);
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (v === "cover" || v === "contain" || v === "fill") return v;
  alert("Fit mode must be one of: cover, contain, fill.");
  return null;
}

function railButton(
  glyph: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "rail-btn";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.textContent = glyph;
  b.addEventListener("click", onClick);
  return b;
}
