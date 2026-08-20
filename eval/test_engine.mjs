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
const { punchInterior, stampCut, floodBlack, alphaOf, decontaminate } = await import("../lib/cutout.js");
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

function manyPaneWindow() {
  const img = rgb(200, 200, 24, 24, 24);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 36 + col * 30;
      const y = 36 + row * 30;
      fillRect(img, x, y, x + 22, y + 22, 8, 8, 8);
    }
  }
  return img;
}

{
  const img = manyPaneWindow();
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `16-pane classified as window (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[47 * 200 + 47] < 16, "first small pane punched");
  assert(a[47 * 200 + 77] < 16, "adjacent small pane punched");
  assert(a[137 * 200 + 137] < 16, "last small pane punched");
  assert(a[2 * 200 + 2] > 180, "16-pane outer frame kept");
  assert(a[47 * 200 + 62] > 180, "16-pane mullion kept");
  assert(cut.pipeline === "écran", "16-pane uses screen pipeline");
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

{
  const img = rgb(200, 200, 236, 214, 176);
  fillRect(img, 70, 70, 130, 130, 40, 90, 160);
  const punch = (x, y) => fillRect(img, x - 1, y - 1, x + 2, y + 2, 8, 8, 8);
  for (let i = 50; i <= 150; i += 8) {
    punch(i, 50);
    punch(i, 150);
    punch(50, i);
    punch(150, i);
  }
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `inset stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[100 * 200 + 100] > 180, "inset stamp design kept");
  assert(a[60 * 200 + 100] > 180, "inset stamp paper margin kept (whole piece)");
  assert(a[50 * 200 + 90] < 16, "inset stamp perforations punched");
  assert(a[8 * 200 + 8] < 16, "album paper around inset stamp gone");
  assert(cut.pipeline === "timbre", "inset stamp uses stamp pipeline");
}

{
  const img = rgb(280, 160, 236, 214, 176);
  fillRect(img, 40, 40, 100, 120, 40, 90, 160);
  fillRect(img, 180, 40, 240, 120, 160, 50, 40);
  const punch = (x, y) => fillRect(img, x - 1, y - 1, x + 2, y + 2, 8, 8, 8);
  for (let i = 20; i <= 120; i += 8) {
    punch(i, 20);
    punch(i, 140);
    punch(20, i);
    punch(120, i);
  }
  for (let i = 160; i <= 260; i += 8) {
    punch(i, 20);
    punch(i, 140);
  }
  for (let i = 20; i <= 140; i += 8) {
    punch(160, i);
    punch(260, i);
  }
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `two inset stamps classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[80 * 280 + 70] > 180, "left inset stamp design kept");
  assert(a[80 * 280 + 210] > 180, "right inset stamp design kept");
  assert(a[30 * 280 + 70] > 180, "left inset stamp paper margin kept");
  assert(a[30 * 280 + 210] > 180, "right inset stamp paper margin kept");
  assert(a[20 * 280 + 60] < 16, "left inset perforations punched");
  assert(a[20 * 280 + 200] < 16, "right inset perforations punched");
  assert(a[80 * 280 + 140] < 16, "album paper between inset stamps gone");
  assert(a[8 * 280 + 8] < 16, "outer album paper gone");
  assert(cut.pipeline === "timbre", "two inset stamps use stamp pipeline");
}

{
  const img = rgb(120, 120, 8, 8, 8);
  fillRect(img, 30, 30, 90, 90, 255, 80, 180);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 120 + 60] > 180, "logo body kept");
  assert(a[2 * 120 + 2] < 16, "black studio bg gone");
  assert(cut.needsRefine === false, "logo on black must not be sent to IA");
}

{
  const img = rgb(24, 24, 255, 255, 255);
  for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = 3;
  const center = (12 * 24 + 12) * 4;
  img.data[center + 3] = 255;
  const clean = decontaminate(img);
  const a = alphaOf(clean);
  assert(a[0] === 0 && a[12 * 24 + 12] === 255, "weak alpha halo is removed without touching subject");
}

{
  const img = rgb(80, 80, 52, 52, 52);
  fillRect(img, 12, 12, 68, 68, 30, 30, 30);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `dusk-gray pane classified as window (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "dusk-gray pane punched (frame 52 / glass 30, not only lum<=22)");
  assert(a[2 * 80 + 2] > 180, "dusk-gray window frame kept");
}

function skyPaneWindow() {
  const img = rgb(80, 80, 48, 42, 36);
  fillRect(img, 6, 6, 36, 36, 92, 168, 220);
  fillRect(img, 44, 6, 74, 36, 88, 160, 214);
  fillRect(img, 6, 44, 36, 74, 96, 172, 224);
  fillRect(img, 44, 44, 74, 74, 90, 164, 218);
  return img;
}

{
  const img = skyPaneWindow();
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `4-pane sky window classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[20 * 80 + 20] < 16, "sky top-left pane punched");
  assert(a[20 * 80 + 60] < 16, "sky top-right pane punched");
  assert(a[60 * 80 + 20] < 16, "sky bottom-left pane punched");
  assert(a[60 * 80 + 60] < 16, "sky bottom-right pane punched");
  assert(a[2 * 80 + 2] > 180, "sky-window outer frame kept");
  assert(a[40 * 80 + 40] > 180, "sky-window mullion kept");
  assert(cut.pipeline === "écran", "sky window uses screen pipeline");
}

{
  const img = rgb(220, 120, 70, 110, 170);
  fillRect(img, 14, 16, 96, 104, 40, 90, 160);
  fillRect(img, 124, 16, 206, 104, 160, 50, 40);
  const cut = stampCut(img);
  const a = alphaOf(cut);
  assert(a[60 * 220 + 55] > 180, "left stamp on blue album kept");
  assert(a[60 * 220 + 165] > 180, "right stamp on blue album kept");
  assert(a[4 * 220 + 4] < 16, "blue album paper flooded");
  assert(a[60 * 220 + 110] < 16, "blue album between stamps gone");
}

{
  const img = rgb(220, 120, 168, 168, 168);
  fillRect(img, 14, 16, 96, 104, 40, 90, 160);
  fillRect(img, 124, 16, 206, 104, 160, 50, 40);
  const cut = stampCut(img);
  const a = alphaOf(cut);
  assert(a[60 * 220 + 55] > 180, "left stamp on gray album kept");
  assert(a[60 * 220 + 165] > 180, "right stamp on gray album kept");
  assert(a[4 * 220 + 4] < 16, "gray album paper flooded");
  assert(a[60 * 220 + 110] < 16, "gray album between stamps gone");
}

{
  const img = rgb(220, 120, 70, 110, 170);
  fillRect(img, 14, 16, 96, 104, 236, 214, 176);
  fillRect(img, 28, 30, 82, 90, 40, 90, 160);
  fillRect(img, 124, 16, 206, 104, 236, 214, 176);
  fillRect(img, 138, 30, 192, 90, 160, 50, 40);
  perforate(img);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `stamps on blue album classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 220 + 55] > 180, "left blue-album stamp design kept");
  assert(a[22 * 220 + 55] > 180, "left blue-album cream margin kept (whole piece)");
  assert(a[60 * 220 + 165] > 180, "right blue-album stamp design kept");
  assert(a[22 * 220 + 165] > 180, "right blue-album cream margin kept (whole piece)");
  assert(a[4 * 220 + 4] < 16, "blue album around perforated stamps gone");
  assert(a[60 * 220 + 110] < 16, "blue album between perforated stamps gone");
  assert(cut.pipeline === "timbre", "blue-album stamps use stamp pipeline");
}

console.log("engine window+stamp+eyes+logo+halo ok");
