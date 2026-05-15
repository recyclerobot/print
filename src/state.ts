/**
 * Central reactive state layer built on nanostores.
 *
 * Architecture: the existing `store` class (src/store.ts) remains the source
 * of truth and owns mutations + persistence. After every `store.emit()` it
 * broadcasts a snapshot here, so UI code can subscribe to fine-grained atoms
 * without manually rebuilding entire panels.
 *
 * Why this matters: derived display values (tile size, total area, DPI, …)
 * become *computed atoms* that automatically recalculate whenever their
 * dependencies change. A panel can keep its focus-preserving "skip rebuild
 * while editing" optimization AND still show live readouts, because each
 * readout is bound to its own atom and updates independently of the DOM tree
 * around it.
 */
import { atom, computed, type ReadableAtom } from "nanostores";
import type { AnyElement, ImageElement, Page, PrintDocument } from "./types";
import type { Prefs } from "./store";

// --- Primary atoms ---------------------------------------------------------
// These are written to by the bridge in `store.ts`. Treat them as read-only
// from UI code; mutations always go through the store API.

/** The full document tree (replaced on every change). */
export const $doc = atom<PrintDocument | null>(null);
/** Id of the page currently shown on canvas. */
export const $currentPageId = atom<string>("");
/** Set of element ids currently selected. New Set instance on every change. */
export const $selectedIds = atom<Set<string>>(new Set());
/** App-wide preferences (unit, snap, visibility toggles, …). */
export const $prefs = atom<Prefs | null>(null);
/** Undo / redo stack depths so toolbar can disable buttons reactively. */
export const $undoDepth = atom<number>(0);
export const $redoDepth = atom<number>(0);

// --- Computed atoms --------------------------------------------------------

/** The currently active page object, or undefined.
 *  Returns a shallow clone so subscribers fire even when the underlying page
 *  was mutated in place (the existing store mutates rather than replacing). */
export const $currentPage = computed(
  [$doc, $currentPageId],
  (doc, id): Page | undefined => {
    const p = doc?.pages.find((p) => p.id === id);
    return p ? { ...p } : undefined;
  },
);

/** The list of selected elements on the current page. */
export const $selectedElements = computed(
  [$currentPage, $selectedIds],
  (page, ids): AnyElement[] => {
    if (!page) return [];
    return page.elements.filter((e) => ids.has(e.id));
  },
);

/** The single selected element, or null when 0 / multi-selection. */
export const $singleSelection = computed(
  [$selectedElements],
  (els): AnyElement | null => (els.length === 1 ? els[0] : null),
);

/** The chosen unit (mm | cm | in | pt). */
export const $unit = computed([$prefs], (p) => p?.unit ?? "mm");

// --- Per-element computed factory -----------------------------------------
// Building a computed atom for "this specific element id" lets readouts in
// the inspector subscribe to just that element's slice of the document.

/** Live element by id, recomputed whenever the document changes.
 *  Returns a shallow clone so reference equality always changes. */
export function elementAtom(id: string): ReadableAtom<AnyElement | null> {
  return computed([$currentPage], (page): AnyElement | null => {
    if (!page) return null;
    const el = page.elements.find((e) => e.id === id);
    return el ? ({ ...el } as AnyElement) : null;
  });
}

/** For an image element id, derived per-tile + total dimensions in mm. */
export interface ImageMeasurements {
  tileWidth: number; // mm
  tileHeight: number; // mm
  totalWidth: number; // mm (== el.width)
  totalHeight: number; // mm (== el.height)
  repeatX: number;
  repeatY: number;
  isRepeated: boolean;
}

export function imageMeasurementsAtom(
  id: string,
): ReadableAtom<ImageMeasurements | null> {
  const el$ = elementAtom(id);
  return computed([el$], (el): ImageMeasurements | null => {
    if (!el || el.type !== "image") return null;
    const img = el as ImageElement;
    const rx = img.repeatX ?? 1;
    const ry = img.repeatY ?? 1;
    const gap = img.repeatGap ?? 0;
    return {
      tileWidth: (img.width - gap * (rx - 1)) / rx,
      tileHeight: (img.height - gap * (ry - 1)) / ry,
      totalWidth: img.width,
      totalHeight: img.height,
      repeatX: rx,
      repeatY: ry,
      isRepeated: rx > 1 || ry > 1,
    };
  });
}

/** For an image element, effective print DPI based on per-tile size. */
export interface DpiReadout {
  dpi: number;
  dpiW: number;
  dpiH: number;
}

export function imageDpiAtom(id: string): ReadableAtom<DpiReadout | null> {
  const el$ = elementAtom(id);
  const m$ = imageMeasurementsAtom(id);
  return computed([el$, m$], (el, m): DpiReadout | null => {
    if (!el || el.type !== "image" || !m) return null;
    const img = el as ImageElement;
    if (!img.naturalWidth || !img.naturalHeight) return null;
    const wIn = m.tileWidth / 25.4;
    const hIn = m.tileHeight / 25.4;
    const dpiW = wIn > 0 ? img.naturalWidth / wIn : 0;
    const dpiH = hIn > 0 ? img.naturalHeight / hIn : 0;
    let dpi: number;
    if (img.fit === "cover") dpi = Math.max(dpiW, dpiH);
    else dpi = Math.min(dpiW, dpiH);
    return { dpi, dpiW, dpiH };
  });
}

// --- DOM binding helpers ---------------------------------------------------

/** Subscribe to an atom and apply the value to a target. Returns unsubscribe.
 *  Skips the initial synchronous call's side effect if `skipInitial` is set. */
export function bind<T>(
  source: ReadableAtom<T>,
  apply: (value: T) => void,
): () => void {
  return source.subscribe((v) => apply(v));
}
