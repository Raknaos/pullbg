/**
 * PullBG in-process worker.
 * Runs the exact same validated geometry (lib/classify.js + lib/cutout.js)
 * as the browser build, then delegates general objects to the local rembg
 * AI service via HTTP. One worker at a time — queue discipline for 1-2 users.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage, ImageData } = require("@napi-rs/canvas");

// Browser-only globals used by lib/*.js — provided by napi canvas in Node.
globalThis.ImageData = globalThis.ImageData ?? ImageData;

import { classifyImage } from "../lib/classify.js";
import {
  chromaCut, floodBlack, floodWhite, floodColor, stampCut, punchInterior,
  decontaminate, scoreCut, cleanupSpeckles,
} from "../lib/cutout.js";

const AI_URL = process.env.PULLBG_AI_URL || "http://127.0.0.1:8155";
const MAX_EDGE = 2200;
const AI_TIMEOUT_MS = 90_000;

function u16(buf, off, le) {
  if (off + 2 > buf.length) return 0;
  return le ? buf[off] | (buf[off + 1] << 8) : (buf[off] << 8) | buf[off + 1];
}

function u32(buf, off, le) {
  if (off + 4 > buf.length) return 0;
  return (le
    ? buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)
    : (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

function readIfdOrientation(buf, tiff, ifdRel, le) {
  const ifd = tiff + ifdRel;
  if (ifd + 2 > buf.length) return 0;
  const n = u16(buf, ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > buf.length) break;
    if (u16(buf, e, le) !== 0x0112) continue;
    const type = u16(buf, e + 2, le);
    const count = u32(buf, e + 4, le);
    if (count !== 1) continue;
    const value = type === 3 ? u16(buf, e + 8, le) : u32(buf, e + 8, le);
    if (value >= 1 && value <= 8) return value;
  }
  return 0;
}

/** JPEG EXIF Orientation (1–8). Other formats and missing tags → 1. */
export function jpegOrientation(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return 1;
  let offset = 2;
  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xFF) break;
    const marker = buf[offset + 1];
    if (marker === 0xDA || marker === 0xD9) break;
    const size = (buf[offset + 2] << 8) | buf[offset + 3];
    if (size < 2 || offset + 2 + size > buf.length) break;
    if (marker === 0xE1) {
      const start = offset + 4;
      if (
        start + 14 < buf.length &&
        buf[start] === 0x45 && buf[start + 1] === 0x78 &&
        buf[start + 2] === 0x69 && buf[start + 3] === 0x66 &&
        buf[start + 4] === 0 && buf[start + 5] === 0
      ) {
        const tiff = start + 6;
        const le = buf[tiff] === 0x49 && buf[tiff + 1] === 0x49;
        const mm = buf[tiff] === 0x4D && buf[tiff + 1] === 0x4D;
        if ((le || mm) && u16(buf, tiff + 2, le) === 42) {
          const ori = readIfdOrientation(buf, tiff, u32(buf, tiff + 4, le), le);
          if (ori) return ori;
        }
      }
    }
    offset += 2 + size;
  }
  return 1;
}

function applyOrientationTransform(ctx, w, h, ori) {
  switch (ori) {
    case 2: ctx.setTransform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.setTransform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.setTransform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.setTransform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.setTransform(0, 1, -1, 0, h, 0); break;
    case 7: ctx.setTransform(0, -1, -1, 0, h, w); break;
    case 8: ctx.setTransform(0, -1, 1, 0, 0, w); break;
    default: break;
  }
}

function paintOriented(img, ori) {
  if (ori === 1) return img;
  const swap = ori >= 5 && ori <= 8;
  const w = swap ? img.height : img.width;
  const h = swap ? img.width : img.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  applyOrientationTransform(ctx, img.width, img.height, ori);
  ctx.drawImage(img, 0, 0);
  return canvas;
}

function stripJpegExif(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return buf;
  const parts = [buf.subarray(0, 2)];
  let offset = 2;
  let dropped = false;
  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xFF) {
      parts.push(buf.subarray(offset));
      break;
    }
    const marker = buf[offset + 1];
    if (marker === 0xDA) {
      parts.push(buf.subarray(offset));
      break;
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) {
      parts.push(buf.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const size = buf.readUInt16BE(offset + 2);
    if (size < 2 || offset + 2 + size > buf.length) {
      parts.push(buf.subarray(offset));
      break;
    }
    const start = offset + 4;
    const isExif = marker === 0xE1
      && start + 6 <= buf.length
      && buf[start] === 0x45 && buf[start + 1] === 0x78
      && buf[start + 2] === 0x69 && buf[start + 3] === 0x66
      && buf[start + 4] === 0 && buf[start + 5] === 0;
    if (isExif) dropped = true;
    else parts.push(buf.subarray(offset, offset + 2 + size));
    offset += 2 + size;
  }
  return dropped ? Buffer.concat(parts) : buf;
}

/** Decode any image buffer (png/jpg/webp/gif) into ImageData-like. */
export async function decodeToImage(buffer) {
  const ori = jpegOrientation(buffer);
  const img = await loadImage(ori === 1 ? buffer : stripJpegExif(buffer));
  const source = paintOriented(img, ori);
  let w = source.width;
  let h = source.height;
  if (Math.max(w, h) > MAX_EDGE) {
    const s = MAX_EDGE / Math.max(w, h);
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(h * s));
  }
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function packed(image, name) {
  const cleaned = decontaminate(image);
  return { image: cleaned, name, score: scoreCut(cleaned) };
}

function packedGeo(image, name) {
  const cleaned = cleanupSpeckles(decontaminate(image));
  return { image: cleaned, name, score: scoreCut(cleaned) };
}

function bestOf(list) {
  return list.reduce((b, c) => (c.score.score > b.score.score ? c : b));
}

function usableModelResult(c) {
  const s = c.score;
  return s.tr >= 0.015 && s.tr < 0.94 && s.ck >= 0.18 && s.br >= 0.15;
}

function fallbacks(image, guess) {
  if (guess.mode === "noir") {
    return [packedGeo(floodBlack(image, 26), "secours-noir"), packedGeo(floodBlack(image, 40), "secours-noir40")];
  }
  if (guess.mode === "ia" && guess.kind === "objet / produit") {
    return [packedGeo(floodWhite(image, 20), "secours-blanc")];
  }
  return [packedGeo(floodWhite(image, 20), "secours-blanc"), packedGeo(floodBlack(image, 26), "secours-noir")];
}

/** Fast deterministic pass — same decision tree as the browser fastCut. */
export function fastCutServer(image) {
  const guess = classifyImage(image);

  if (guess.mode === "timbre") {
    const winner = packedGeo(stampCut(image), "timbre");
    return { image: winner.image, guess, pipeline: winner.name, needsRefine: false };
  }
  if (guess.mode === "couleur") {
    const winner = packedGeo(chromaCut(image), "couleur");
    return { image: winner.image, guess, pipeline: winner.name, needsRefine: false };
  }
  if (guess.interior && guess.mode === "noir") {
    const winner = packedGeo(punchInterior(image, "black"), "écran");
    return { image: winner.image, guess, pipeline: winner.name, needsRefine: false };
  }
  if (guess.interior) {
    const winner = packedGeo(punchInterior(image, "white"), "page");
    return { image: winner.image, guess, pipeline: winner.name, needsRefine: false };
  }
  if (guess.mode === "fond") {
    const winner = packedGeo(floodColor(image), "fond");
    const failed = winner.score.tr < 0.015 || winner.score.br < 0.15;
    return { image: winner.image, guess, pipeline: winner.name, needsRefine: failed };
  }
  if (guess.mode === "noir") {
    const winner = bestOf(fallbacks(image, guess));
    const failed = winner.score.tr < 0.015 || winner.score.br < 0.15;
    return { image: winner.image, guess, pipeline: winner.name, needsRefine: failed };
  }
  const preview = bestOf(fallbacks(image, guess));
  return { image: preview.image, guess, pipeline: preview.name, needsRefine: true };
}

export function chooseRefinedServer(draft, model) {
  const usable = model && usableModelResult(model) ? model : draft;
  return { image: usable.image, guess: draft.guess, pipeline: usable.name ?? usable.pipeline, needsRefine: false };
}

/** PNG-encode an ImageData-like with its alpha. */
export function encodePng(image) {
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  const id = ctx.createImageData(image.width, image.height);
  id.data.set(image.data);
  ctx.putImageData(id, 0, 0);
  return canvas.toBuffer("image/png");
}

/** Ask rembg; hang/timeout returns null so the single worker can move on. */
export async function askRembg(pngBuffer, timeoutMs = AI_TIMEOUT_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const fd = new FormData();
    fd.append("file", new Blob([pngBuffer], { type: "image/png" }), "input.png");
    const res = await fetch(`${AI_URL}/cut`, { method: "POST", body: fd, signal: ac.signal });
    if (!res.ok) return null;
    return packed(await decodeToImage(Buffer.from(await res.arrayBuffer())), "ia");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Full job: geometry first, then AI when the classifier asks for it. */
export async function processImage(buffer, opts = {}) {
  const original = await decodeToImage(buffer);
  const draft = fastCutServer(original);
  if (!draft.needsRefine) return { ...draft, buffer: encodePng(draft.image) };

  // Same as browser refineCut: rembg sees the already-oriented, 2200px-capped pixels.
  const model = await askRembg(encodePng(original), opts.aiTimeoutMs ?? AI_TIMEOUT_MS);
  const final = chooseRefinedServer(draft, model);
  return { ...final, buffer: encodePng(final.image) };
}