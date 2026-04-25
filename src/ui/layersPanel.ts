import { store } from "../store";
import type { AnyElement } from "../types";
import type { Renderer } from "../webgl/renderer";

// Layers panel for the current page. Top of the list = front-most.
// Internally, page.elements is back-to-front (later = drawn on top), so we
// reverse for display.
export function buildLayersPanel(
  host: HTMLElement,
  renderer: Renderer,
  requestRender: () => void,
): void {
  let dragSourceId: string | null = null;

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
  icon.textContent = el.type === "text" ? "T" : el.type === "image" ? "🖼" : "▭";
  item.appendChild(icon);

  // Name (preview text for text elements)
  const name = document.createElement("span");
  name.className = "layer-name";
  name.textContent = el.name || layerLabel(el);
  item.appendChild(name);

  // Visibility toggle
  const vis = document.createElement("button");
  vis.className = "layer-icon-btn";
  vis.title = el.hidden ? "Show" : "Hide";
  vis.textContent = el.hidden ? "○" : "●";
  vis.addEventListener("click", (e) => {
    e.stopPropagation();
    store.updateElement(el.id, { hidden: !el.hidden });
    requestRender();
  });
  item.appendChild(vis);

  // Lock toggle
  const lock = document.createElement("button");
  lock.className = "layer-icon-btn";
  lock.title = el.locked ? "Unlock" : "Lock";
  lock.textContent = el.locked ? "🔒" : "🔓";
  lock.addEventListener("click", (e) => {
    e.stopPropagation();
    store.updateElement(el.id, { locked: !el.locked });
    requestRender();
  });
  item.appendChild(lock);

  // Click selects
  item.addEventListener("click", (e) => {
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
    if (!getDragSource() || getDragSource() === el.id) return;
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
    requestRender();
  });
  void renderer;
  return item;
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
