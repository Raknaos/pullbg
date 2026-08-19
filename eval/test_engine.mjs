/** Synthetic engine tests: window punch + whole stamp. */
if (typeof ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(dataOrW, wOrH, h) {
      if (typeof dataOrW === "number") {
        this.width = dataOrW;
        this.height = wOrH;
        this.data = new Uint8ClampedArray(dataOrW * wOrH * 4);
      } else {
        this.data = dataOrW;
        this.width = wOrH;
        this.height = h ?? dataOrW.length / 4 / wOrH;
      }
    }
  };
}

const { classifyImage } = await import("../lib/classify.js");
const { punchInterior, stampCut, floodBlack, alphaOf } = await import("../lib/cutout.js");
const { fastCut } = await import("../lib/engine.js");

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

function frac(alpha, pred) {
  let n = 0;
  for (let i = 0; i < alpha.length; i++) if (pred(alpha[i])) n++;
  return n / alpha.length;
}

function windowShot() {
  const img = rgb(80, 80, 20, 20, 20);
  fillRect(img, 12, 12, 68, 68, 8, 8, 8);
  return img;
}

{
  const img = windowShot();
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", "window classified as closed black interior");
  const eaten = floodBlack(img, 26);
  assert(frac(alphaOf(eaten), (a) => a < 16) > 0.9, "old flood-first would eat the frame");
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "window center punched");
  assert(a[2 * 80 + 2] > 180, "window frame kept");
  assert(cut.pipeline === "écran", "window uses screen pipeline");
}

{
  const img = rgb(80, 80, 90, 90, 90);
  fillRect(img, 10, 10, 50, 70, 6, 6, 6);
  fillRect(img, 54, 18, 72, 62, 252, 252, 252);
  const black = punchInterior(img, "black");
  const white = punchInterior(img, "white");
  assert(alphaOf(black)[40 * 80 + 30] < 16, "prefer black punches dark pane");
  assert(alphaOf(black)[40 * 80 + 62] > 180, "prefer black keeps white pane");
  assert(alphaOf(white)[40 * 80 + 62] < 16, "prefer white punches page");
  assert(alphaOf(white)[40 * 80 + 30] > 180, "prefer white keeps dark pane");
}

function stampScan() {
  const img = rgb(160, 160, 180, 150, 90);
  const punch = (x, y) => fillRect(img, x - 1, y - 1, x + 2, y + 2, 8, 8, 8);
  for (let i = 12; i <= 148; i += 8) {
    punch(i, 1);
    punch(i, 158);
    punch(1, i);
    punch(158, i);
  }
  return img;
}

{
  const img = stampScan();
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[80 * 160 + 80] > 180, "stamp body kept whole");
  assert(a[1 * 160 + 12] < 16, "perforation hole punched");
  assert(cut.pipeline === "timbre", "stamp uses stamp pipeline");
}

{
  const img = rgb(120, 120, 250, 250, 250);
  fillRect(img, 20, 20, 100, 100, 150, 80, 50);
  const cut = stampCut(img);
  const a = alphaOf(cut);
  assert(a[60 * 120 + 60] > 180, "light-scan stamp body kept");
  assert(a[2 * 120 + 2] < 16, "light paper flood removes sheet");
}

{
  const img = rgb(120, 120, 250, 250, 250);
  fillRect(img, 20, 20, 100, 100, 210, 170, 140);
  fillRect(img, 40, 48, 52, 60, 10, 10, 10);
  fillRect(img, 68, 48, 80, 60, 10, 10, 10);
  const guess = classifyImage(img);
  assert(guess.mode === "ia", `face classified for IA (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[54 * 120 + 46] > 180, "left pupil kept (not filled as a hole)");
  assert(a[54 * 120 + 74] > 180, "right pupil kept (not filled as a hole)");
  assert(cut.needsRefine === true, "products always refine with IA");
}

console.log("engine window+stamp+eyes ok");
