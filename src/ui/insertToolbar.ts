import { store } from "../store";
import { newImageElement, newRectElement, newTextElement } from "../store";
import { prepareImportedImage } from "../imageImport";

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
