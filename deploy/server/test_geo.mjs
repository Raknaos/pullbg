/** Worker geo must match the browser: studio flood + 2200px cap. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCanvas, ImageData } = require("@napi-rs/canvas");
globalThis.ImageData = globalThis.ImageData ?? ImageData;

const { fastCutServer, decodeToImage, encodePng, processImage } = await import("./worker.mjs");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function rgb(w, h, r, g, b) {
  const image = new ImageData(w, h);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  return image;
}

function fillRect(image, x0, y0, x1, y1, r, g, b) {
  const { data, width: w } = image;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
}

{
  const img = rgb(120, 80, 0, 180, 60);
  fillRect(img, 40, 20, 80, 60, 200, 40, 40);
  const cut = fastCutServer(img);
  assert(cut.guess.mode === "fond", `green studio classified (${cut.guess.kind})`);
  assert(cut.pipeline === "fond", `studio uses color flood, got ${cut.pipeline}`);
  assert(cut.needsRefine === false, "working studio flood skips rembg");
  const a = (x, y) => cut.image.data[(y * 120 + x) * 4 + 3];
  assert(a(60, 40) > 180, "studio subject kept");
  assert(a(2, 2) < 16, "green screen flooded");
}

{
  const img = rgb(120, 80, 210, 210, 210);
  for (let y = 0; y < 80; y++) {
    const v = Math.round(210 - (y / 79) * 72);
    fillRect(img, 0, y, 120, y + 1, v, v, v);
  }
  fillRect(img, 38, 16, 84, 58, 200, 40, 40);
  const cut = fastCutServer(img);
  assert(cut.pipeline === "fond", `cyclorama uses color flood, got ${cut.pipeline}`);
  assert(cut.needsRefine === false, "working cyclorama flood skips rembg");
}

{
  const canvas = createCanvas(3000, 1800);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#00b43c";
  ctx.fillRect(0, 0, 3000, 1800);
  ctx.fillStyle = "#c82828";
  ctx.fillRect(1100, 600, 800, 600);
  const decoded = await decodeToImage(canvas.toBuffer("image/png"));
  assert(decoded.width === 2200, `wide photo capped to 2200, got ${decoded.width}`);
  assert(decoded.height === 1320, `height scaled with the cap, got ${decoded.height}`);
}

{
  const canvas = createCanvas(3000, 1800);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 3000, 1800);
  ctx.fillStyle = "#888888";
  ctx.fillRect(1100, 600, 800, 600);
  const raw = canvas.toBuffer("image/png");
  const capped = encodePng(await decodeToImage(raw));
  const again = await decodeToImage(capped);
  assert(again.width === 2200, `AI source width is the 2200 cap, got ${again.width}`);
  assert(again.height === 1320, `AI source height scaled with the cap, got ${again.height}`);

  const prev = globalThis.fetch;
  let sentW = 0;
  let sentH = 0;
  globalThis.fetch = async (_url, opts) => {
    const file = opts.body.get("file");
    const buf = Buffer.from(await file.arrayBuffer());
    const img = await decodeToImage(buf);
    sentW = img.width;
    sentH = img.height;
    return { ok: false, status: 503 };
  };
  try {
    const out = await processImage(raw);
    assert(out.guess.mode === "ia", `gray product asks rembg (${out.guess.kind})`);
    assert(sentW === 2200, `rembg received capped width, got ${sentW}`);
    assert(sentH === 1320, `rembg received capped height, got ${sentH}`);
  } finally {
    globalThis.fetch = prev;
  }
}

console.log("worker geo: studio flood + 2200px rembg source OK");
