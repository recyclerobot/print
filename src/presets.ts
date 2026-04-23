import type { Margins, Bleed, PageSize } from "./types";

// Built-in document presets ("default templates"). Each preset captures the
// full print spec a designer needs: trim (netto) size, bleed (afloop, so the
// bruto/bleedbox = trim + bleed), and a recommended safety zone applied as
// document margins so text & important content stays inside it.
export interface DocumentPreset {
  id: string;
  name: string;
  description?: string;
  size: PageSize; // NETTO / trim — the final cut size
  bleed: Bleed; // afloop around the trim → bruto = size + bleed
  margins: Margins; // safety zone (text-safe area) inside the trim
}

export const DOCUMENT_PRESETS: DocumentPreset[] = [
  {
    id: "a6-card",
    name: "A6 Card (105×148, 2mm bleed)",
    description:
      "Bruto 109×152 mm · Netto 105×148 mm · Afloop 2 mm · Veiligheidszone 3 mm",
    size: { width: 105, height: 148 },
    bleed: { top: 2, right: 2, bottom: 2, left: 2 },
    margins: { top: 3, right: 3, bottom: 3, left: 3 },
  },
];

export function findPreset(id: string): DocumentPreset | undefined {
  return DOCUMENT_PRESETS.find((p) => p.id === id);
}
