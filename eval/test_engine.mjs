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

function fourPaneWindow() {
  const img = rgb(80, 80, 22, 22, 22);
  fillRect(img, 6, 6, 36, 36, 6, 6, 6);
  fillRect(img, 44, 6, 74, 36, 6, 6, 6);
  fillRect(img, 6, 44, 36, 74, 6, 6, 6);
  fillRect(img, 44, 44, 74, 74, 6, 6, 6);
  return img;
}

{
  const img = fourPaneWindow();
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `4-pane classified as window (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[20 * 80 + 20] < 16, "top-left pane punched");
  assert(a[20 * 80 + 60] < 16, "top-right pane punched");
  assert(a[60 * 80 + 20] < 16, "bottom-left pane punched");
  assert(a[60 * 80 + 60] < 16, "bottom-right pane punched");
  assert(a[2 * 80 + 2] > 180, "outer frame kept");
  assert(a[40 * 80 + 40] > 180, "mullion kept");
}

{
  const img = rgb(80, 80, 32, 32, 32);
  fillRect(img, 12, 12, 68, 68, 20, 20, 20);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `gray JPEG pane classified as window (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "gray pane punched (JPEG-black, not only lum<=14)");
  assert(a[2 * 80 + 2] > 180, "gray-window frame kept");
}

{
  const img = rgb(140, 140, 236, 214, 176);
  fillRect(img, 28, 28, 112, 112, 40, 90, 160);
  const cut = stampCut(img);
  const a = alphaOf(cut);
  assert(a[70 * 140 + 70] > 180, "cream-sheet stamp body kept");
  assert(a[4 * 140 + 4] < 16, "cream paper flood removes sheet");
}

{
  const img = rgb(80, 80, 36, 36, 36);
  fillRect(img, 12, 12, 68, 68, 240, 240, 240);
  const guess = classifyImage(img);
  assert(guess.interior, `JPEG-white pane classified as page (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "JPEG-white pane punched (not only lum>=248)");
  assert(a[2 * 80 + 2] > 180, "JPEG-white page frame kept");
}

{
  const img = rgb(80, 80, 70, 90, 60);
  fillRect(img, 18, 18, 62, 62, 210, 210, 210);
  const guess = classifyImage(img);
  assert(!guess.interior, "mid-light patch is not a JPEG-white page");
}

{
  const img = stampScan();
  fillRect(img, 48, 48, 112, 112, 16, 16, 16);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `engraved stamp is not a window (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[80 * 160 + 80] > 180, "engraved center kept (not punched as a pane)");
  assert(a[1 * 160 + 12] < 16, "engraved stamp still punches perforations");
  assert(cut.pipeline === "timbre", "engraved stamp uses stamp pipeline");
}

{
  const img = rgb(220, 120, 236, 214, 176);
  fillRect(img, 14, 16, 96, 104, 40, 90, 160);
  fillRect(img, 124, 16, 206, 104, 160, 50, 40);
  const cut = stampCut(img);
  const a = alphaOf(cut);
  assert(a[60 * 220 + 55] > 180, "left stamp on a sheet kept whole");
  assert(a[60 * 220 + 165] > 180, "right stamp on a sheet kept whole");
  assert(a[4 * 220 + 4] < 16, "cream album paper still flooded");
}

function perforate(img) {
  const punch = (x, y) => fillRect(img, x - 1, y - 1, x + 2, y + 2, 8, 8, 8);
  const { width: w, height: h } = img;
  for (let i = 12; i <= w - 12; i += 8) {
    punch(i, 1);
    punch(i, h - 2);
  }
  for (let i = 12; i <= h - 12; i += 8) {
    punch(1, i);
    punch(w - 2, i);
  }
}

{
  const img = rgb(160, 160, 236, 214, 176);
  fillRect(img, 48, 48, 112, 112, 40, 90, 160);
  perforate(img);
  const cut = stampCut(img);
  const a = alphaOf(cut);
  assert(a[80 * 160 + 80] > 180, "scanned stamp design kept");
  assert(a[20 * 160 + 20] > 180, "cream paper margin kept (whole piece)");
  assert(a[1 * 160 + 12] < 16, "perforation still punched");
}

{
  const img = rgb(220, 120, 236, 214, 176);
  fillRect(img, 14, 16, 96, 104, 40, 90, 160);
  fillRect(img, 124, 16, 206, 104, 160, 50, 40);
  perforate(img);
  const cut = stampCut(img);
  const a = alphaOf(cut);
  assert(a[60 * 220 + 55] > 180, "left stamp kept with outer holes");
  assert(a[60 * 220 + 165] > 180, "right stamp kept with outer holes");
  assert(a[60 * 220 + 110] < 16, "album paper between stamps still gone");
}

console.log("engine window+stamp+eyes ok");
