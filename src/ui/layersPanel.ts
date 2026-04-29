import { store } from "../store";
import type { AnyElement } from "../types";
import type { Renderer } from "../webgl/renderer";

// Tiny stroke-icon set for the layers panel. Keeping the markup local avoids
// pulling in an icon library while giving us crisp scalable glyphs.
const SVG = (path: string): string =>
  `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICONS = {
  text: SVG(`<path d="M3 4h10M8 4v9M5.5 13h5"/>`),
  rect: SVG(`<rect x="2.5" y="3.5" width="11" height="9" rx="1"/>`),
  image: SVG(
    `<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="6" cy="7" r="1.2"/><path d="M2.5 12l3.5-3.5 2.5 2.5L11 8.5l2.5 2.5"/>`,
  ),
  eye: SVG(
    `<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>`,
  ),
  eyeOff: SVG(
    `<path d="M2 2l12 12"/><path d="M3.5 5.7C2.2 6.8 1.5 8 1.5 8s2.4 4.5 6.5 4.5c1.2 0 2.2-.3 3.1-.8"/><path d="M6.4 4c.5-.1 1-.2 1.6-.2 4.1 0 6.5 4.2 6.5 4.2s-.6 1-1.7 2.1"/><path d="M9.6 9.6a2 2 0 0 1-2.7-2.7"/>`,
  ),
  lock: SVG(
    `<rect x="3.5" y="7" width="9" height="6" rx="1"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/>`,
  ),
  unlock: SVG(
    `<rect x="3.5" y="7" width="9" height="6" rx="1"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 4.7-1.1"/>`,
  ),
};

// Layers panel for the current page. Top of the list = front-most.
// Internally, page.elements is back-to-front (later = drawn on top), so we
// reverse for display.
export function buildLayersPanel(
  host: HTMLElement,
  renderer: Renderer,
  requestRender: () => void,
): void {
  let dragSourceId: string | null = null;
  // Drag operations replace the panel DOM mid-drag, so the original element's
  // `dragend` listener never fires. A window-level listener guarantees we
  // always clear the source id after the operating system finishes the drag.
  window.addEventListener("dragend", () => {
    dragSourceId = null;
  });

  const render = (): void => {
    host.innerHTML = "";

    const header = document.createElement("div");
    header.className = "panel-header";
    header.innerHTML = "<h3>Layers</h3>";
    host.appendChild(header);

    const page = store.currentPage;
    if (!page) return;

    if (!page.elements.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent =
        "No layers yet. Add text, a shape, or an image from the left rail.";
      host.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "layer-list";

    // Display front-most first.
    const display = [...page.elements].reverse();
    for (const el of display) {
      list.appendChild(
        renderItem(
          el,
          renderer,
          requestRender,
          () => dragSourceId,
          (id) => {
            dragSourceId = id;
          },
        ),
      );
    }
    host.appendChild(list);
  };

  store.subscribe(render);
  render();
}

function renderItem(
  el: AnyElement,
  renderer: Renderer,
  requestRender: () => void,
  getDragSource: () => string | null,
  setDragSource: (id: string | null) => void,
): HTMLElement {
  const item = document.createElement("div");
  item.className = "layer-item";
  item.draggable = true;
  if (store.selectedIds.has(el.id)) item.classList.add("active");
  if (el.hidden) item.classList.add("hidden");

  // Type icon
  const icon = document.createElement("span");
  icon.className = "layer-icon";
  icon.innerHTML =
    el.type === "text"
      ? ICONS.text
      : el.type === "image"
        ? ICONS.image
        : ICONS.rect;
  item.appendChild(icon);

  // Name (preview text for text elements)
  const name = document.createElement("span");
  name.className = "layer-name";
  name.textContent = el.name || layerLabel(el);
  item.appendChild(name);

  // Visibility toggle
  const vis = iconBtn(
    el.hidden ? ICONS.eyeOff : ICONS.eye,
    el.hidden ? "Show layer" : "Hide layer",
    () => {
      store.transact(() => {
        // Use transact so visibility changes can be undone, and so the panel
        // / canvas stay in sync via emit().
        const target = store.currentPage?.elements.find((e) => e.id === el.id);
        if (target) target.hidden = !target.hidden;
      });
      requestRender();
    },
  );
  if (el.hidden) vis.classList.add("active");
  item.appendChild(vis);

  // Lock toggle
  const lock = iconBtn(
    el.locked ? ICONS.lock : ICONS.unlock,
    el.locked ? "Unlock layer" : "Lock layer",
    () => {
      store.transact(() => {
        const target = store.currentPage?.elements.find((e) => e.id === el.id);
        if (target) target.locked = !target.locked;
      });
      requestRender();
    },
  );
  if (el.locked) lock.classList.add("active");
  item.appendChild(lock);

  // Click selects (ignore clicks that bubbled from the icon buttons — those
  // call e.stopPropagation already, but be defensive).
  item.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".layer-icon-btn")) return;
    if (e.shiftKey) {
      const next = new Set(store.selectedIds);
      if (next.has(el.id)) next.delete(el.id);
      else next.add(el.id);
      store.setSelection([...next]);
    } else {
      store.setSelection(el.id);
    }
    requestRender();
  });

  // Drag-and-drop reorder
  item.addEventListener("dragstart", (e) => {
    setDragSource(el.id);
    item.classList.add("dragging");
    e.dataTransfer?.setData("text/plain", el.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  item.addEventListener("dragend", () => {
    item.classList.remove("dragging");
    setDragSource(null);
  });
  item.addEventListener("dragover", (e) => {
    const src = getDragSource();
    if (!src || src === el.id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const r = item.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    item.classList.toggle("drop-before", before);
    item.classList.toggle("drop-after", !before);
  });
  item.addEventListener("dragleave", () => {
    item.classList.remove("drop-before", "drop-after");
  });
  item.addEventListener("drop", (e) => {
    e.preventDefault();
    const sourceId = getDragSource() ?? e.dataTransfer?.getData("text/plain");
    item.classList.remove("drop-before", "drop-after");
    if (!sourceId || sourceId === el.id) return;
    const r = item.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    moveElementRelative(sourceId, el.id, before);
    setDragSource(null);
    requestRender();
  });
  void renderer;
  return item;
}

function iconBtn(
  svg: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "layer-icon-btn";
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.innerHTML = svg;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  });
  // Don't trigger drag when starting from an icon button.
  b.addEventListener("mousedown", (e) => e.stopPropagation());
  return b;
}

function layerLabel(el: AnyElement): string {
  if (el.type === "text") {
    const t = el.text.trim().replace(/\s+/g, " ");
    return t.length ? (t.length > 28 ? t.slice(0, 28) + "…" : t) : "Text";
  }
  if (el.type === "image") return "Image";
  return "Shape";
}

// Move source so that, in display order (front-most first), it lands either
// directly before or directly after target. The internal page.elements array
// is back-to-front, so display order is its reverse.
function moveElementRelative(
  sourceId: string,
  targetId: string,
  beforeInDisplay: boolean,
): void {
  const page = store.currentPage;
  if (!page) return;
  const elements = page.elements;
  const fromIdx = elements.findIndex((e) => e.id === sourceId);
  const targetIdx = elements.findIndex((e) => e.id === targetId);
  if (fromIdx < 0 || targetIdx < 0 || sourceId === targetId) return;

  // Display index = (length - 1) - storageIndex.
  // "before in display" === "after in storage".
  // Compute the destination storage index, accounting for removal of source first.
  store.transact(() => {
    const [moved] = elements.splice(fromIdx, 1);
    const newTargetIdx = elements.findIndex((e) => e.id === targetId);
    const destIdx = beforeInDisplay ? newTargetIdx + 1 : newTargetIdx;
    elements.splice(destIdx, 0, moved);
  });
}
