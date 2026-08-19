import { classifyImage } from "./classify.js";
import {
  bitmapFromSource,
  imageDataFromBitmap,
  floodBlack,
  floodWhite,
  punchInterior,
  stampCut,
  decontaminate,
  scoreCut,
  protectSubject,
  cleanupSpeckles,
  blobFromImageData,
} from "./cutout.js";

let removeBackground = null;
let warming = null;

async function ensureModel() {
  if (removeBackground) return;
  if (!warming) {
    warming = import("https://esm.sh/@imgly/background-removal@1.7.0").then((mod) => {
      removeBackground = mod.default || mod.removeBackground;
    });
  }
  await warming;
}

export function warmup() {
  return ensureModel().catch(() => {});
}

async function runIa(file) {
  await ensureModel();
  const blob = await removeBackground(file, { device: "gpu", model: "isnet_fp16" });
  return imageDataFromBitmap(await createImageBitmap(blob)).image;
}

function pack(image, name) {
  const cleaned = decontaminate(image);
  return { image: cleaned, name, score: scoreCut(cleaned) };
}

function packGeo(image, name) {
  const cleaned = cleanupSpeckles(decontaminate(image));
  return { image: cleaned, name, score: scoreCut(cleaned) };
}

function bestOf(list) {
  return list.reduce((a, b) => (b.score.score > a.score.score ? b : a));
}

export function strong(score) {
  return score && score.score >= 0.42 && score.tr >= 0.05 && score.ck >= 0.28 && score.tr < 0.9;
}

export function fastCut(image) {
  const guess = classifyImage(image);
  let winner;
  if (guess.mode === "timbre") {
    winner = packGeo(stampCut(image), "timbre");
    return { image: winner.image, guess, pipeline: winner.name, score: winner.score, needsRefine: false };
  }
  if (guess.interior && guess.mode === "noir") {
    winner = packGeo(punchInterior(image, "black"), "écran");
    return { image: winner.image, guess, pipeline: winner.name, score: winner.score, needsRefine: false };
  }
  if (guess.interior) {
    winner = packGeo(punchInterior(image, "white"), "page");
    return { image: winner.image, guess, pipeline: winner.name, score: winner.score, needsRefine: false };
  }
  if (guess.mode === "noir") {
    winner = bestOf([packGeo(floodBlack(image, 22), "n22"), packGeo(floodBlack(image, 34), "n34")]);
    return { image: winner.image, guess, pipeline: winner.name, score: winner.score, needsRefine: !strong(winner.score) };
  }
  winner = packGeo(floodWhite(image, 20), "blanc");
  return { image: winner.image, guess, pipeline: winner.name, score: winner.score, needsRefine: true };
}

export async function refineCut(file, draft, sourceImage) {
  if (!draft.needsRefine) return draft;
  try {
    const input = sourceImage ? await blobFromImageData(sourceImage) : file;
    const ia = pack(await runIa(input), "ia");
    const mix = pack(protectSubject(ia.image, draft.image), "mix");
    const winner = bestOf([ia, mix, draft]);
    return { image: winner.image, guess: draft.guess, pipeline: winner.name, score: winner.score, needsRefine: false };
  } catch {
    return { ...draft, needsRefine: false };
  }
}

export async function smartCut(file) {
  const original = imageDataFromBitmap(await bitmapFromSource(file), 2200).image;
  const draft = fastCut(original);
  return refineCut(file, draft, original);
}
