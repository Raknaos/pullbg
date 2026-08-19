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

async function ensureModel() {
  if (removeBackground) return;
  const mod = await import("https://esm.sh/@imgly/background-removal@1.7.0");
  removeBackground = mod.default || mod.removeBackground;
}

async function runIa(file) {
  await ensureModel();
  const blob = await removeBackground(file, { device: "gpu", model: "isnet_fp16" });
  const bmp = await createImageBitmap(blob);
  return imageDataFromBitmap(bmp).image;
}

function bestOf(cands) {
  let best = cands[0];
  for (const c of cands) if (c.score.score > best.score.score) best = c;
  return best;
}

export async function smartCut(file, { mode = "auto", interior = false, onStatus } = {}) {
  const say = (s) => { if (onStatus) onStatus(s); };
  const bitmap = await bitmapFromSource(file);
  const original = imageDataFromBitmap(bitmap).image;
  const guess = mode === "auto" ? classifyImage(original) : {
    kind: mode,
    mode,
    interior,
    reason: "choix manuel",
  };
  const useMode = mode === "auto" ? guess.mode : mode;
  const useInterior = Boolean(interior || (mode === "auto" && guess.interior));
  say(guess.kind);

  const cands = [];
  const push = (image, name) => {
    if (!image) return;
    const scored = cleanupSpeckles(decontaminate(image));
    cands.push({ image: scored, name, score: scoreCut(scored) });
  };

  if (useMode === "timbre") {
    say("timbre v4");
    push(stampCut(original), "timbre");
  } else if (useMode === "noir") {
    say("fond noir");
    push(floodBlack(original, 22), "noir22");
    push(floodBlack(original, 32), "noir32");
  } else if (useMode === "blanc") {
    say("fond blanc");
    push(floodWhite(original, 16), "blanc16");
    push(floodWhite(original, 28), "blanc28");
  } else if (useMode !== "aucun") {
    say("IA");
    try {
      const ia = await runIa(file);
      push(ia, "ia");
      const geo = guess.mode === "noir" ? floodBlack(original) : floodWhite(original);
      if (scoreCut(geo).score > 0.15) {
        push(protectSubject(ia, geo), "ia+geo");
      }
    } catch (err) {
      say("IA indisponible, secours géométrique");
    }
    const black = floodBlack(original);
    const white = floodWhite(original);
    if (scoreCut(black).tr > 0.02) push(black, "secours-noir");
    if (scoreCut(white).tr > 0.02) push(white, "secours-blanc");
  } else {
    push(original, "aucun");
  }

  if (!cands.length) push(original, "source");
  let winner = bestOf(cands);
  if (useMode !== "timbre" && useMode !== "aucun") {
    const filled = fillInteriorHoles(winner.image);
    if (scoreCut(filled).score >= winner.score.score * 0.98) {
      winner = { image: filled, name: winner.name + "+trous", score: scoreCut(filled) };
    }
  }
  if (useInterior) {
    say("intérieur");
    const punched = punchInterior(winner.image);
    winner = { image: punched, name: winner.name + "+intérieur", score: scoreCut(punched) };
  }

  return {
    image: winner.image,
    guess,
    pipeline: winner.name,
    score: winner.score,
  };
}
