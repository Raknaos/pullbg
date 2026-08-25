/** Worker geo must match the browser: studio flood + 2200px cap. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCanvas, ImageData } = require("@napi-rs/canvas");
globalThis.ImageData = globalThis.ImageData ?? ImageData;

const { fastCutServer, decodeToImage, encodePng, processImage, askRembg, jpegOrientation, hintForImage } = await import("./worker.mjs");

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

function busyBg(image) {
  const { data, width: w, height: h } = image;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = 60 + ((x * 13 + y * 7) % 90);
      data[i + 1] = 70 + ((x * 5 + y * 11) % 80);
      data[i + 2] = 80 + ((x * 3 + y * 17) % 100);
      data[i + 3] = 255;
    }
  }
}

function facePortrait() {
  const img = rgb(80, 120, 0, 0, 0);
  busyBg(img);
  fillRect(img, 22, 14, 58, 52, 198, 142, 112);
  fillRect(img, 30, 28, 36, 34, 40, 28, 24);
  fillRect(img, 44, 28, 50, 34, 40, 28, 24);
  fillRect(img, 34, 38, 46, 44, 160, 90, 80);
  return img;
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

function hangFetch() {
  return (_url, opts) => new Promise((_resolve, reject) => {
    const signal = opts && opts.signal;
    if (!signal) return;
    const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

{
  const prev = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = (_url, opts) => {
    const inner = hangFetch();
    return inner(_url, opts).catch((err) => {
      aborted = true;
      throw err;
    });
  };
  try {
    const png = encodePng(rgb(32, 32, 200, 40, 40));
    const t0 = Date.now();
    const model = await askRembg(png, 80);
    const dt = Date.now() - t0;
    assert(model === null, "hung rembg returns null");
    assert(aborted, "hung rembg is aborted");
    assert(dt < 2000, `rembg timeout should be fast, took ${dt}ms`);
  } finally {
    globalThis.fetch = prev;
  }
}

{
  const canvas = createCanvas(80, 80);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(0, 0, 80, 80);
  ctx.fillStyle = "#555555";
  ctx.fillRect(22, 18, 36, 44);
  const raw = canvas.toBuffer("image/png");

  const prev = globalThis.fetch;
  globalThis.fetch = hangFetch();
  try {
    const t0 = Date.now();
    const out = await processImage(raw, { aiTimeoutMs: 80 });
    const dt = Date.now() - t0;
    assert(out.buffer && out.buffer.length > 0, "hung rembg still returns a PNG");
    assert(out.pipeline !== "ia", `fallback pipeline, got ${out.pipeline}`);
    assert(dt < 2000, `processImage must not wait on hung rembg, took ${dt}ms`);
  } finally {
    globalThis.fetch = prev;
  }
}

function exifApp1(orientation) {
  const payload = Buffer.alloc(32);
  payload.write("Exif\0\0", 0, 6, "binary");
  payload.write("II", 6, 2, "ascii");
  payload.writeUInt16LE(42, 8);
  payload.writeUInt32LE(8, 10);
  payload.writeUInt16LE(1, 14);
  payload.writeUInt16LE(0x0112, 16);
  payload.writeUInt16LE(3, 18);
  payload.writeUInt32LE(1, 20);
  payload.writeUInt16LE(orientation, 24);
  payload.writeUInt32LE(0, 28);
  const app1 = Buffer.alloc(4 + payload.length);
  app1[0] = 0xFF;
  app1[1] = 0xE1;
  app1.writeUInt16BE(2 + payload.length, 2);
  payload.copy(app1, 4);
  return app1;
}

function jpegWithOrientation(jpeg, orientation) {
  assert(jpeg[0] === 0xFF && jpeg[1] === 0xD8, "canvas JPEG starts with SOI");
  return Buffer.concat([Buffer.from([0xFF, 0xD8]), exifApp1(orientation), jpeg.subarray(2)]);
}

{
  const png = encodePng(rgb(16, 16, 10, 20, 30));
  assert(jpegOrientation(png) === 1, "PNG has no EXIF orientation");
  assert(jpegOrientation(Buffer.from([0, 1, 2])) === 1, "garbage is orientation 1");
}

{
  const canvas = createCanvas(80, 40);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e02020";
  ctx.fillRect(0, 0, 40, 40);
  ctx.fillStyle = "#2040e0";
  ctx.fillRect(40, 0, 40, 40);
  const raw = canvas.toBuffer("image/jpeg", 95);
  assert(jpegOrientation(raw) === 1, "plain JPEG is orientation 1");

  const tagged = jpegWithOrientation(raw, 6);
  assert(jpegOrientation(tagged) === 6, `injected EXIF 6, got ${jpegOrientation(tagged)}`);

  const plain = await decodeToImage(raw);
  assert(plain.width === 80 && plain.height === 40, `plain JPEG stays 80x40, got ${plain.width}x${plain.height}`);
  const px = (img, x, y) => {
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  const left = px(plain, 10, 20);
  const right = px(plain, 70, 20);
  assert(left[0] > 160 && left[2] < 80, `plain left is red, got ${left}`);
  assert(right[2] > 160 && right[0] < 80, `plain right is blue, got ${right}`);

  const rotated = await decodeToImage(tagged);
  assert(rotated.width === 40 && rotated.height === 80, `ori 6 swaps to 40x80, got ${rotated.width}x${rotated.height}`);
  const top = px(rotated, 20, 8);
  const bottom = px(rotated, 20, 72);
  assert(top[0] > 160 && top[2] < 80, `ori 6 puts red on top (phone portrait), got ${top}`);
  assert(bottom[2] > 160 && bottom[0] < 80, `ori 6 puts blue at bottom, got ${bottom}`);
}

{
  const canvas = createCanvas(3000, 1200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#00b43c";
  ctx.fillRect(0, 0, 3000, 1200);
  ctx.fillStyle = "#c82828";
  ctx.fillRect(200, 200, 800, 800);
  const tagged = jpegWithOrientation(canvas.toBuffer("image/jpeg", 90), 6);
  const decoded = await decodeToImage(tagged);
  assert(decoded.width === 880, `ori 6 then 2200 cap width, got ${decoded.width}`);
  assert(decoded.height === 2200, `ori 6 then 2200 cap height, got ${decoded.height}`);
}

{
  const portrait = facePortrait();
  assert(hintForImage(portrait) === "person", `portrait routes to person, got ${hintForImage(portrait)}`);

  const product = rgb(80, 120, 240, 240, 240);
  fillRect(product, 22, 30, 58, 90, 90, 90, 96);
  assert(hintForImage(product) === "product", `gray product stays product, got ${hintForImage(product)}`);

  const copper = rgb(120, 80, 240, 240, 240);
  fillRect(copper, 30, 18, 90, 62, 188, 96, 42);
  assert(hintForImage(copper) === "product", `landscape copper product stays product, got ${hintForImage(copper)}`);
}

{
  const raw = encodePng(facePortrait());

  const prev = globalThis.fetch;
  let sent = "";
  globalThis.fetch = async (_url, opts) => {
    sent = String(opts.body.get("hint") || "");
    return { ok: false, status: 503 };
  };
  try {
    const out = await processImage(raw);
    assert(sent === "person", `rembg received person hint, got ${sent}`);
    assert(out.hint === "person", `processImage exposes person hint, got ${out.hint}`);
    assert(out.buffer && out.buffer.length > 0, "portrait still returns a PNG if rembg fails");
  } finally {
    globalThis.fetch = prev;
  }
}

console.log("worker geo: studio flood + 2200px rembg source + rembg timeout + jpeg exif + person hint OK");
