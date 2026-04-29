// Helpers for importing user-supplied raster images.
//
// Goals:
//  - Cap stored pixel dimensions so very large photos don't bloat localStorage
//    (which is typically limited to ~5MB) and the JSON-based undo history.
//  - Re-encode JPEGs at moderate quality to further shrink data URLs while
//    preserving alpha for PNG/WebP.
//  - Keep the *reported* natural dimensions equal to the *actual* stored pixel
//    dimensions so downstream DPI calculations remain truthful.

export interface PreparedImage {
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

// 4096 px on the longest side gives ~340 DPI on an A4 page (210mm) which is
// well above print-quality. Keeps re-encoded data URLs in the low MB range.
const MAX_DIMENSION = 4096;
const JPEG_QUALITY = 0.9;

export async function prepareImportedImage(file: File): Promise<PreparedImage> {
  const original = await fileToDataUrl(file);
  const img = await loadImageEl(original);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) throw new Error("Could not decode image.");

  // Decide whether to keep alpha. JPEG/JPG sources never have alpha; PNG/WebP
  // may, so we re-encode them as PNG to preserve transparency.
  const isJpeg = /^data:image\/jpe?g/i.test(original);
  const longest = Math.max(iw, ih);
  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;

  // Fast path: small JPEG that we don't need to touch.
  if (scale === 1 && isJpeg && original.length < 2_500_000) {
    return { dataUrl: original, naturalWidth: iw, naturalHeight: ih };
  }

  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);

  const mime = isJpeg ? "image/jpeg" : "image/png";
  const dataUrl = isJpeg
    ? canvas.toDataURL(mime, JPEG_QUALITY)
    : canvas.toDataURL(mime);
  return { dataUrl, naturalWidth: w, naturalHeight: h };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("Read error"));
    r.readAsDataURL(file);
  });
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Decode failed"));
    img.src = src;
  });
}
