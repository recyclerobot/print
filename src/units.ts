import type { Unit } from './types';

// 1 inch = 25.4 mm = 72 pt
export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

export function mmToPx(mm: number, dpi: number): number {
  return (mm / MM_PER_INCH) * dpi;
}
export function pxToMm(px: number, dpi: number): number {
  return (px / dpi) * MM_PER_INCH;
}
export function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PT_PER_INCH;
}
export function ptToMm(pt: number): number {
  return (pt / PT_PER_INCH) * MM_PER_INCH;
}

export function fromUnit(value: number, unit: Unit, dpi = 96): number {
  switch (unit) {
    case 'mm': return value;
    case 'cm': return value * 10;
    case 'in': return value * MM_PER_INCH;
    case 'pt': return ptToMm(value);
    case 'px': return pxToMm(value, dpi);
  }
}
export function toUnit(mm: number, unit: Unit, dpi = 96): number {
  switch (unit) {
    case 'mm': return mm;
    case 'cm': return mm / 10;
    case 'in': return mm / MM_PER_INCH;
    case 'pt': return mmToPt(mm);
    case 'px': return mmToPx(mm, dpi);
  }
}

export function formatUnit(mm: number, unit: Unit, decimals = 2): string {
  return `${toUnit(mm, unit).toFixed(decimals)} ${unit}`;
}
