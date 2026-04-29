// Helpers for importing user-supplied raster images.
//
// localStorage is hard-capped at ~5MB per origin, and the entire document
// (including all images, history snapshots, etc.) has to fit there. So our
// real constraint is *bytes per image*, not pixels. We aim for ~1.8MB per
// image as a data URL — leaves headroom for several images plus undo
// history. If the source has no transparency we transcode to JPEG, which
// is dramatically smaller than PNG for photos.

export interface PreparedImage {
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

// Target byte budget for the encoded data URL.
const TARGET_BYTES = 1_800_000;
// Hard ceiling: never store an image larger than this even after retries.
const MAX_BYTES = 3_000_000;
// Initial pixel cap on the longest side. We may shrink further to hit the
// byte budget for very high-entropy photos.
const INITIAL_MAX_DIMENSION = 4096;
const MIN_DIMENSION = 512;

export async function prepareImportedImage(file: File): Promise<PreparedImage> {
  const original = await fileToDataUrl(file);
  const img = await loadImageEl(original);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) throw new Error("Could not decode image.");

  // If the file is already comfortably small, keep it as-is.
  if (original.length <= TARGET_BYTES) {
    return { dataUrl: original, naturalWidth: iw, naturalHeight: ih };
  }

  // Decide output format: keep alpha if the source actually uses it.
  const sourceIsJpeg = /^data:image\/jpe?g/i.test(original);
  const hasAlpha = sourceIsJpeg ? false : detectAlpha(img);
  const outMime = hasAlpha ? "image/png" : "image/jpeg";

  // Iteratively try (dimension, quality) combinations until we get under
  // the target byte budget. Each pass either lowers JPEG quality or scales
  // the canvas down by ~15%.
  let maxDim = Math.min(INITIAL_MAX_DIMENSION, Math.max(iw, ih));
  const qualitySteps = [0.9, 0.82, 0.75, 0.68, 0.6];
  let qIdx = 0;

  let best: { url: string; w: number; h: number } | null = null;

  while (maxDim >= MIN_DIMENSION) {
    const scale = Math.min(1, maxDim / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const url = encode(img, w, h, outMime, qualitySteps[qIdx]);

    if (url.length <= TARGET_BYTES) {
      return { dataUrl: url, naturalWidth: w, naturalHeight: h };
    }
    if (!best || url.length < best.url.length) best = { url, w, h };

    if (outMime === "image/jpeg" && qIdx < qualitySteps.length - 1) {
      qIdx++;
    } else {
      maxDim = Math.floor(maxDim * 0.85);
      qIdx = 0;
    }
  }

  if (best && best.url.length <= MAX_BYTES) {
    return { dataUrl: best.url, naturalWidth: best.w, naturalHeight: best.h };
  }
  throw new Error(
    `Image is too large to store locally (${formatMB(best?.url.length ?? original.length)}). ` +
      `Try a smaller image, or one without transparency.`,
  );
}

function encode(
  img: HTMLImageElement,
  w: number,
  h: number,
  mime: string,
  quality: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Fill white behind JPEG so any transparent edges don't render as black.
  if (mime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, 0, 0, w, h);
  return mime === "image/jpeg"
    ? canvas.toDataURL(mime, quality)
    : canvas.toDataURL(mime);
}

// Sample the image and return true if any pixel has alpha < 250. Avoids
// transcoding photographs to PNG just because the source happened to be PNG.
function detectAlpha(img: HTMLImageElement): boolean {
  const sw = Math.min(64, img.naturalWidth);
  const sh = Math.min(64, img.naturalHeight);
  if (!sw || !sh) return false;
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, sw, sh);
  try {
    const data = ctx.getImageData(0, 0, sw, sh).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return true;
    }
  } catch {
    // CORS-tainted canvas (shouldn't happen for user-uploaded files) —
    // fall back to assuming alpha to be safe.
    return true;
  }
  return false;
}

function formatMB(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
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
