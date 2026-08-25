/** Classify 3 windows + 1 stamp. Exit 1 if a window looks like a stamp. */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const { createCanvas, loadImage, ImageData } = require("@napi-rs/canvas");
globalThis.ImageData = globalThis.ImageData ?? ImageData;

const { classifyImage } = await import("../lib/classify.js");
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(ROOT, "cases");

async function load(p) {
  const img = await loadImage(p);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

const checks = [
  { id: "win-01", file: "win-01.jpg", forbid: ["timbre"] },
  { id: "win-02", file: "win-02.jpg", forbid: ["timbre"] },
  { id: "win-03", file: "win-03.jpg", forbid: ["timbre"] },
  { id: "stamp-01", file: "stamp-01.jpg", want: "timbre" },
  { id: "stamp-03", file: "stamp-03.jpg", want: "timbre" },
];

let fail = 0;
for (const c of checks) {
  const p = path.join(CASES, c.file);
  if (!existsSync(p)) {
    console.log("SKIP", c.id, "missing");
    continue;
  }
  const g = classifyImage(await load(p));
  const bad = c.forbid?.includes(g.mode);
  const miss = c.want && g.mode !== c.want;
  if (bad || miss) {
    fail += 1;
    console.log("FAIL", c.id, g.mode, g.kind, g.reason);
  } else {
    console.log("OK", c.id, g.mode, g.kind);
  }
}
process.exit(fail ? 1 : 0);
