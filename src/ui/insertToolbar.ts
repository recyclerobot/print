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

    try {
      // Prepare images and store each as a shared asset (deduped).
      const prepared = await Promise.all(
        files.map((f) => prepareImportedImage(f)),
      );
      const assetIds = prepared.map((p) => store.addAsset(p.dataUrl));

      // Sensible defaults: auto-compute a grid that fits all images.
      const count = prepared.length;
      const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
      const rows = Math.max(1, Math.ceil(count / cols));
      const cellW = store.doc.size.width / cols;
      const cellH = store.doc.size.height / rows;
      const fit: ImageElement["fit"] = "cover";
      const gridGroup = `grid_${Math.random().toString(36).slice(2, 10)}`;
      const total = rows * cols;

      const created: ImageElement[] = [];
      for (let i = 0; i < total; i++) {
        const idx = i % prepared.length;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * cellW;
        const y = row * cellH;
        created.push(
          newImageElement({
            src: "", // data lives in shared assets pool
            assetId: assetIds[idx],
            x,
            y,
            width: cellW,
            height: cellH,
            fit,
            naturalWidth: prepared[idx].naturalWidth,
            naturalHeight: prepared[idx].naturalHeight,
            gridGroup,
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
