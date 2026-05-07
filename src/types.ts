// Core document model. All measurements are stored in millimeters (mm)
// for printing accuracy. Convert to px/pt only at render/export boundaries.

export type Unit = "mm" | "cm" | "in" | "pt" | "px";

export interface Margins {
  top: number; // mm
  right: number; // mm
  bottom: number; // mm
  left: number; // mm
}

export interface Bleed {
  top: number; // mm
  right: number; // mm
  bottom: number; // mm
  left: number; // mm
}

export interface PageSize {
  width: number; // mm
  height: number; // mm
}

export interface BaseElement {
  id: string;
  name?: string;
  type: "text" | "image" | "rect";
  x: number; // mm, top-left
  y: number; // mm, top-left
  width: number; // mm
  height: number; // mm
  rotation: number; // degrees
  opacity: number; // 0..1
  locked?: boolean;
  hidden?: boolean;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number; // pt
  fontWeight: number; // 100..900
  italic: boolean;
  color: string; // hex
  lineHeight: number; // multiplier
  letterSpacing: number; // em
  align: "left" | "center" | "right" | "justify";
  vAlign: "top" | "middle" | "bottom";
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string; // data URL or empty when assetId is set
  fit: "contain" | "cover" | "fill";
  naturalWidth?: number;
  naturalHeight?: number;
  /** Points into PrintDocument.assets — avoids duplicating large data URLs. */
  assetId?: string;
  /** Elements sharing the same gridGroup form a page-filling image grid. */
  gridGroup?: string;
}

export interface RectElement extends BaseElement {
  type: "rect";
  fill: string; // hex with alpha optional
  stroke: string; // hex
  strokeWidth: number; // mm
  cornerRadius: number; // mm
}

export type AnyElement = TextElement | ImageElement | RectElement;

export interface Page {
  id: string;
  name: string;
  templateId?: string;
  elements: AnyElement[];
  background: string; // hex
}

export interface Template {
  id: string;
  name: string;
  elements: AnyElement[];
  background: string;
}

export interface PrintDocument {
  id: string;
  name: string;
  size: PageSize;
  margins: Margins;
  bleed: Bleed;
  pages: Page[];
  templates: Template[];
  defaultTemplateId?: string;
  /** Shared image data-URL pool keyed by asset id. */
  assets?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

/** Resolve the actual data-URL for an image element. If assetId is set and
 *  exists in the document asset pool, return that; otherwise fall back to
 *  the inline `src` field. */
export function resolveImageSrc(el: ImageElement, doc: PrintDocument): string {
  if (el.assetId && doc.assets?.[el.assetId]) return doc.assets[el.assetId];
  return el.src;
}

export const A_SIZES: Record<string, PageSize> = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  A6: { width: 105, height: 148 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  Square: { width: 210, height: 210 },
  Postcard: { width: 148, height: 105 },
};
