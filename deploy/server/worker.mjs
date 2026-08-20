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
  chromaCut, floodBlack, floodWhite, stampCut, punchInterior,
  decontaminate, scoreCut, cleanupSpeckles,
} from "../lib/cutout.js";

const AI_URL = process.env.PULLBG_AI_URL || "http://127.0.0.1:8155";

/** Decode any image buffer (png/jpg/webp/gif) into ImageData-like. */
export async function decodeToImage(buffer) {
  const img = await loadImage(buffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
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

  if (guess.mode === "timbre") return { image: packedGeo(stampCut(image), "timbre").image, guess, pipeline: "timbre", needsRefine: false };
  if (guess.mode === "couleur") return { image: packedGeo(chromaCut(image), "couleur").image, guess, pipeline: "couleur", needsRefine: false };
  if (guess.interior && guess.mode === "noir") return { image: packedGeo(punchInterior(image, "black"), "écran").image, guess, pipeline: "écran", needsRefine: false };
  if (guess.interior) return { image: packedGeo(punchInterior(image, "white"), "page").image, guess, pipeline: "page", needsRefine: false };
  if (guess.mode === "noir") {
    const w = bestOf(fallbacks(image, guess));
    return { image: w.image, guess, pipeline: w.name, needsRefine: false };
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

/** Full job: geometry first, then AI when the classifier asks for it. */
export async function processImage(buffer) {
  const original = await decodeToImage(buffer);
  const draft = fastCutServer(original);
  if (!draft.needsRefine) return { ...draft, buffer: encodePng(draft.image) };

  // General object — ask the local rembg service for a high-quality mask.
  let model = null;
  try {
    const fd = new FormData();
    fd.append("file", new Blob([buffer], { type: "application/octet-stream" }), "input.png");
    const res = await fetch(`${AI_URL}/cut`, { method: "POST", body: fd });
    if (res.ok) {
      const png = Buffer.from(await res.arrayBuffer());
      model = packed(await decodeToImage(png), "ia");
    }
  } catch {
    model = null;
  }

  const final = chooseRefinedServer(draft, model);
  return { ...final, buffer: encodePng(final.image) };
}