// Inline text editing overlay.
//
// Positions a transparent textarea on top of the canvas at the same screen
// rect, font metrics and rotation as the underlying text element. Edits flow
// straight into the store via `updateElement` so the WebGL preview keeps in
// sync, and the textarea is removed on blur / Escape / Enter (without Shift).
//
// We deliberately keep this as a thin overlay rather than re-implementing
// rich text editing — the existing canvas rasteriser remains the source of
// truth for layout. While editing, the underlying element is hidden so the
// user sees only the editable copy, avoiding ghost duplication.

import { store } from "./store";
import type { TextElement } from "./types";
import type { Renderer } from "./webgl/renderer";

export interface InlineEditor {
  beginEdit(elementId: string): void;
  endEdit(commit?: boolean): void;
  isEditing(): boolean;
  reposition(): void;
}

export function createInlineTextEditor(
  canvas: HTMLCanvasElement,
  renderer: Renderer,
  requestRender: () => void,
): InlineEditor {
  const host = canvas.parentElement!;
  let textarea: HTMLTextAreaElement | null = null;
  let editingId: string | null = null;
  let originalHidden = false;
  let originalText = "";

  function findEl(): TextElement | null {
    if (!editingId) return null;
    const page = store.currentPage;
    const el = page?.elements.find((e) => e.id === editingId);
    return el && el.type === "text" ? el : null;
  }

  function position(): void {
    const el = findEl();
    if (!textarea || !el) return;
    const tl = renderer.mmToScreen(el.x, el.y);
    const w = el.width * renderer.view.zoom;
    const h = el.height * renderer.view.zoom;
    // Text element coordinates are relative to the canvas. The canvas itself
    // can be offset within `canvas-host` (e.g. by rulers), so add canvas's
    // offset position relative to its parent.
    const offsetLeft = canvas.offsetLeft;
    const offsetTop = canvas.offsetTop;
    textarea.style.left = `${offsetLeft + tl.x}px`;
    textarea.style.top = `${offsetTop + tl.y}px`;
    textarea.style.width = `${w}px`;
    textarea.style.height = `${h}px`;
    // Rotate around the centre to mirror the renderer.
    textarea.style.transformOrigin = "0 0";
    textarea.style.transform = el.rotation
      ? `rotate(${el.rotation}deg)`
      : "none";

    // Font metrics — convert pt to px at 72dpi base, then scale by zoom.
    const fontPx = (el.fontSize * 25.4 * renderer.view.zoom) / 72;
    textarea.style.font = `${el.italic ? "italic " : ""}${el.fontWeight} ${fontPx}px ${el.fontFamily}`;
    textarea.style.color = el.color;
    textarea.style.textAlign = el.align === "justify" ? "justify" : el.align;
    textarea.style.lineHeight = String(el.lineHeight);
    textarea.style.letterSpacing = `${el.letterSpacing}em`;
  }

  function beginEdit(id: string): void {
    if (editingId === id) return;
    if (editingId) endEdit(true);
    const page = store.currentPage;
    const el = page?.elements.find((e) => e.id === id);
    if (!el || el.type !== "text") return;
    editingId = id;
    originalHidden = !!el.hidden;
    originalText = el.text;

    // Hide the rasterised copy while editing so we don't see two stacked.
    if (!originalHidden) {
      el.hidden = true;
      store.emit();
    }

    textarea = document.createElement("textarea");
    textarea.className = "inline-text-edit";
    textarea.value = el.text;
    textarea.spellcheck = false;
    textarea.addEventListener("input", () => {
      const cur = findEl();
      if (!cur || !textarea) return;
      cur.text = textarea.value;
      // Live-update the canvas without history churn — final commit captures
      // the change as a single undo step.
      store.emit();
      requestRender();
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        endEdit(false);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        endEdit(true);
      } else {
        // Stop the global keydown handler from intercepting (e.g. Backspace
        // would otherwise delete the whole element).
        e.stopPropagation();
      }
    });
    textarea.addEventListener("blur", () => endEdit(true));
    textarea.addEventListener("mousedown", (e) => e.stopPropagation());
    textarea.addEventListener("dblclick", (e) => e.stopPropagation());
    host.appendChild(textarea);
    position();
    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      textarea.select();
    });
  }

  function endEdit(commit = true): void {
    if (!textarea || !editingId) return;
    const el = findEl();
    const finalText = textarea.value;
    if (el) {
      if (commit && finalText !== originalText) {
        // Roll back the live-updated text so transact's snapshot captures
        // the *pre-edit* state, then re-apply the new text.
        el.text = originalText;
        el.hidden = originalHidden;
        store.transact(() => {
          const t = store.currentPage?.elements.find((e) => e.id === editingId);
          if (t && t.type === "text") t.text = finalText;
        });
      } else {
        // Discard or no-op: revert text and visibility without history entry.
        el.text = originalText;
        el.hidden = originalHidden;
        store.emit();
      }
    }
    textarea.remove();
    textarea = null;
    editingId = null;
    requestRender();
  }

  return {
    beginEdit,
    endEdit,
    isEditing: () => editingId !== null,
    reposition: position,
  };
}
