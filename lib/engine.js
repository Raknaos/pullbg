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
  fillInteriorHoles,
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
  if (guess.mode === "timbre") winner = pack(stampCut(image), "timbre");
  else if (guess.interior && guess.mode === "noir") winner = pack(punchInterior(image, "black"), "écran");
  else if (guess.interior) winner = pack(punchInterior(image, "white"), "page");
  else if (guess.mode === "noir") winner = bestOf([pack(floodBlack(image, 22), "n22"), pack(floodBlack(image, 34), "n34")]);
  else {
    const white = pack(floodWhite(image, 20), "blanc");
    const black = pack(floodBlack(image, 26), "noir");
    const geos = [white, black].filter((c) => c.score.tr > 0.02);
    winner = geos.length ? bestOf(geos) : white;
  }
  if (guess.mode !== "timbre" && !guess.interior) {
    const filled = pack(fillInteriorHoles(winner.image), winner.name);
    if (filled.score.score >= winner.score.score * 0.97) winner = filled;
  }
  return { image: winner.image, guess, pipeline: winner.name, score: winner.score, needsRefine: !guess.interior && guess.mode !== "timbre" && !strong(winner.score) };
}

export async function refineCut(file, draft, sourceImage) {
  if (!draft.needsRefine) return draft;
  try {
    const input = sourceImage ? await blobFromImageData(sourceImage) : file;
    const ia = pack(await runIa(input), "ia");
    const mix = pack(protectSubject(ia.image, draft.image), "mix");
    const winner = bestOf([draft, ia, mix]);
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
