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

/** Decode any image buffer (png/jpg/webp/gif) into ImageData-like. */
export async function decodeToImage(buffer) {
  const img = await loadImage(buffer);
  let w = img.width;
  let h = img.height;
  if (Math.max(w, h) > MAX_EDGE) {
    const s = MAX_EDGE / Math.max(w, h);
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(h * s));
  }
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
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