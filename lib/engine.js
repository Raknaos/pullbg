import { classifyImage } from "./classify.js?v=99";
import {
  bitmapFromSource,
  imageDataFromBitmap,
  floodBlack,
  floodWhite,
  floodColor,
  chromaCut,
  punchInterior,
  stampCut,
  decontaminate,
  scoreCut,
  blobFromImageData,
  cleanupSpeckles,
} from "./cutout.js?v=99";

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
  return list.reduce((best, candidate) => (
    candidate.score.score > best.score.score ? candidate : best
  ));
}

function usableModelResult(candidate) {
  const s = candidate.score;
  return s.tr >= 0.015 && s.tr < 0.94 && s.ck >= 0.18 && s.br >= 0.15;
}

function fallbackCandidates(image, guess) {
  if (guess.mode === "noir") {
    return [
      packGeo(floodBlack(image, 26), "secours-noir"),
      packGeo(floodBlack(image, 40), "secours-noir40"),
    ];
  }
  if (guess.mode === "ia" && guess.kind === "objet / produit") {
    return [packGeo(floodWhite(image, 20), "secours-blanc")];
  }
  return [
    packGeo(floodWhite(image, 20), "secours-blanc"),
    packGeo(floodBlack(image, 26), "secours-noir"),
  ];
}

/**
 * Cheap first frame. It is deliberately not the final decision for objects:
 * the browser displays it while ISNet runs, then refineCut replaces it.
 */
export function fastCut(image) {
  const guess = classifyImage(image);

  if (guess.mode === "timbre") {
    const winner = packGeo(stampCut(image), "timbre");
    return { image: winner.image, guess, pipeline: winner.name, score: winner.score, needsRefine: false };
  }

  if (guess.mode === "couleur") {
    const winner = packGeo(chromaCut(image), "couleur");
    return { image: winner.image, guess, pipeline: winner.name, score: winner.score, needsRefine: false };
  }

  if (guess.interior && guess.mode === "noir") {
    const winner = packGeo(punchInterior(image, "black"), "écran");
    return { image: winner.image, guess, pipeline: winner.name, score: winner.score, needsRefine: false };
  }

  if (guess.interior) {
    const winner = packGeo(punchInterior(image, "white"), "page");
    return { image: winner.image, guess, pipeline: winner.name, score: winner.score, needsRefine: false };
  }

  if (guess.mode === "fond") {
    const winner = packGeo(floodColor(image), "fond");
    const failed = winner.score.tr < 0.015 || winner.score.br < 0.15;
    return { image: winner.image, guess, pipeline: winner.name, score: winner.score, needsRefine: failed };
  }

  if (guess.mode === "noir") {
    const winner = bestOf(fallbackCandidates(image, guess));
    const failed = winner.score.tr < 0.015 || winner.score.br < 0.15;
    return { image: winner.image, guess, pipeline: winner.name, score: winner.score, needsRefine: failed };
  }

  // General objects return a quick preview but are always refined by ISNet.
  const preview = bestOf(fallbackCandidates(image, guess));
  return {
    image: preview.image,
    guess,
    pipeline: preview.name,
    score: preview.score,
    needsRefine: true,
  };
}

export function chooseRefinedResult(draft, model) {
  const winner = usableModelResult(model) ? model : draft;
  return {
    image: winner.image,
    guess: draft.guess,
    pipeline: winner.name ?? winner.pipeline,
    score: winner.score,
    needsRefine: false,
  };
}

/**
 * Final pass. For general objects the model is authoritative, as in v1.
 * Geometry is only a rescue when the model fails or returns no usable mask.
 */
export async function refineCut(file, draft, sourceImage) {
  if (!draft.needsRefine) return draft;
  try {
    const input = sourceImage ? await blobFromImageData(sourceImage) : file;
    const model = pack(await runIa(input), "ia");
    return chooseRefinedResult(draft, model);
  } catch {
    return { ...draft, needsRefine: false };
  }
}

export async function smartCut(file) {
  const original = imageDataFromBitmap(await bitmapFromSource(file), 2200).image;
  const draft = fastCut(original);
  return refineCut(file, draft, original);
}
