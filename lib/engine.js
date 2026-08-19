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

function strong(score) {
  return score.score >= 0.42 && score.tr >= 0.05 && score.ck >= 0.28 && score.tr < 0.9;
}

export async function smartCut(file, { onStatus } = {}) {
  const say = (s) => { if (onStatus) onStatus(s); };
  const original = imageDataFromBitmap(await bitmapFromSource(file)).image;
  const guess = classifyImage(original);
  say(guess.kind);

  let winner;

  if (guess.mode === "timbre") {
    winner = pack(stampCut(original), "timbre");
  } else if (guess.interior && guess.mode === "noir") {
    winner = pack(punchInterior(floodBlack(original, 26)), "écran");
  } else if (guess.interior) {
    winner = pack(punchInterior(original), "page");
  } else if (guess.mode === "noir") {
    winner = bestOf([pack(floodBlack(original, 22), "n22"), pack(floodBlack(original, 34), "n34")]);
    if (!strong(winner.score)) {
      say("précision…");
      try {
        const ia = pack(await runIa(file), "ia");
        winner = bestOf([winner, ia, pack(protectSubject(ia.image, winner.image), "mix")]);
      } catch { /* geo */ }
    }
  } else {
    const white = pack(floodWhite(original, 20), "blanc");
    const black = pack(floodBlack(original, 26), "noir");
    const geos = [white, black].filter((c) => c.score.tr > 0.02);
    winner = geos.length ? bestOf(geos) : white;
    if (!strong(winner.score)) {
      say("précision…");
      try {
        const ia = pack(await runIa(file), "ia");
        winner = bestOf([ia, pack(protectSubject(ia.image, winner.image), "mix"), white, black]);
      } catch { /* geo */ }
    }
  }

  if (guess.mode !== "timbre" && !guess.interior) {
    const filled = pack(fillInteriorHoles(winner.image), winner.name);
    if (filled.score.score >= winner.score.score * 0.97) winner = filled;
  }

  return { image: winner.image, guess, pipeline: winner.name, score: winner.score };
}
