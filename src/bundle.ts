import JSZip from "jszip";
import type { PrintDocument, AnyElement } from "./types";

// Bundle format (v1):
//   project.json          -> the PrintDocument with image src rewritten to
//                            "asset:<filename>" pointers.
//   assets/<filename>     -> binary asset files extracted from data URLs.
//   manifest.json         -> { format: "print-bundle", version: 1, ... }

const BUNDLE_FORMAT = "print-bundle";
const BUNDLE_VERSION = 1;
const ASSET_PREFIX = "asset:";

interface Manifest {
  format: typeof BUNDLE_FORMAT;
  version: number;
  exportedAt: number;
  appVersion: string;
}

export async function exportBundle(doc: PrintDocument): Promise<Blob> {
  const zip = new JSZip();
  const assets = zip.folder("assets")!;
  // Deep clone so we can rewrite srcs without mutating the live document.
  const cloned: PrintDocument = JSON.parse(JSON.stringify(doc));
  const seen = new Map<string, string>(); // dataUrl -> filename (dedupe)
  let counter = 0;

  const rewriteElements = (els: AnyElement[]): void => {
    for (const el of els) {
      if (el.type !== "image") continue;
      const src = el.src;
      if (!src || !src.startsWith("data:")) continue;
      let filename = seen.get(src);
      if (!filename) {
        const { mime, bytes } = decodeDataUrl(src);
        const ext = extForMime(mime);
        filename = `img_${String(counter++).padStart(4, "0")}${ext}`;
        assets.file(filename, bytes);
        seen.set(src, filename);
      }
      el.src = ASSET_PREFIX + filename;
    }
  };

  for (const page of cloned.pages) rewriteElements(page.elements);
  for (const tpl of cloned.templates) rewriteElements(tpl.elements);

  const manifest: Manifest = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: Date.now(),
    appVersion: "0.1.0",
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("project.json", JSON.stringify(cloned, null, 2));

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export async function importBundle(file: File | Blob): Promise<PrintDocument> {
  const zip = await JSZip.loadAsync(file);
  const manifestEntry = zip.file("manifest.json");
  if (manifestEntry) {
    const manifest = JSON.parse(
      await manifestEntry.async("string"),
    ) as Manifest;
    if (manifest.format !== BUNDLE_FORMAT) {
      throw new Error(`Unrecognized bundle format: ${manifest.format}`);
    }
    if (manifest.version > BUNDLE_VERSION) {
      throw new Error(
        `Bundle version ${manifest.version} is newer than supported (${BUNDLE_VERSION}).`,
      );
    }
  }
  const projectEntry = zip.file("project.json");
  if (!projectEntry) throw new Error("Bundle is missing project.json");
  const doc = JSON.parse(await projectEntry.async("string")) as PrintDocument;

  // Re-inline assets by reading binaries from assets/ and converting to data URLs.
  const assetCache = new Map<string, string>();
  const resolveAsset = async (filename: string): Promise<string | null> => {
    const cached = assetCache.get(filename);
    if (cached) return cached;
    const entry = zip.file(`assets/${filename}`);
    if (!entry) return null;
    const blob = await entry.async("blob");
    const mime =
      mimeForName(filename) ?? blob.type ?? "application/octet-stream";
    const dataUrl = await blobToDataUrl(blob, mime);
    assetCache.set(filename, dataUrl);
    return dataUrl;
  };

  const inlineElements = async (els: AnyElement[]): Promise<void> => {
    for (const el of els) {
      if (el.type !== "image") continue;
      if (el.src && el.src.startsWith(ASSET_PREFIX)) {
        const filename = el.src.slice(ASSET_PREFIX.length);
        const dataUrl = await resolveAsset(filename);
        if (dataUrl) el.src = dataUrl;
        else el.src = ""; // missing asset; element will simply not render
      }
    }
  };
  for (const page of doc.pages) await inlineElements(page.elements);
  for (const tpl of doc.templates) await inlineElements(tpl.elements);

  // Basic shape validation.
  if (!doc.pages?.length || !doc.size) {
    throw new Error("Bundle project.json is malformed");
  }
  return doc;
}

function decodeDataUrl(url: string): { mime: string; bytes: Uint8Array } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new Error("Invalid data URL");
  const mime = m[1];
  const isB64 = !!m[2];
  const data = m[3];
  if (isB64) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime, bytes };
  }
  const decoded = decodeURIComponent(data);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return { mime, bytes };
}

function extForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    case "image/bmp":
      return ".bmp";
    default:
      return ".bin";
  }
}

function mimeForName(name: string): string | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    default:
      return null;
  }
}

function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Some browsers report application/octet-stream; rewrite the prefix.
      if (result.startsWith("data:") && !result.startsWith(`data:${mime}`)) {
        const comma = result.indexOf(",");
        resolve(`data:${mime};base64,${result.slice(comma + 1)}`);
      } else {
        resolve(result);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
