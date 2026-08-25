import { createRequire } from "node:module";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire as cr } from "node:module";
import Module from "node:module";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SERVER_NM = path.join(ROOT, "..", "deploy", "server", "node_modules");
Module.globalPaths.unshift(SERVER_NM);
process.env.NODE_PATH = SERVER_NM + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : "");
Module._initPaths();

const require = createRequire(import.meta.url);
const { createCanvas, loadImage, ImageData } = require("@napi-rs/canvas");
globalThis.ImageData = globalThis.ImageData ?? ImageData;

const { classifyImage } = await import("../lib/classify.js");
const { stampCut, decontaminate, cleanupSpeckles } = await import("../lib/cutout.js");

const ids = process.argv.slice(2);
const list = ids.length ? ids : ["stamp-01", "stamp-02", "stamp-03", "stamp-04"];

for (const id of list) {
  const src = path.join(ROOT, "cases", `${id}.jpg`);
  const t0 = Date.now();
  const img = await loadImage(src);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, img.width, img.height);
  const guess = classifyImage(image);
  const cut = cleanupSpeckles(decontaminate(stampCut(image)));
  const out = createCanvas(cut.width, cut.height);
  out.getContext("2d").putImageData(new ImageData(cut.data, cut.width, cut.height), 0, 0);
  const dest = path.join(ROOT, "cases", `${id}.cut.geo.png`);
  writeFileSync(dest, out.toBuffer("image/png"));
  console.log(JSON.stringify({ id, guess, ms: Date.now() - t0, w: cut.width, h: cut.height }));
}
