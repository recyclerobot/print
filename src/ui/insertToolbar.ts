import { store } from "../store";
import { newImageElement, newRectElement, newTextElement } from "../store";

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
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const ratio = img.naturalWidth / img.naturalHeight;
        const w = 80;
        const h = w / ratio;
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
