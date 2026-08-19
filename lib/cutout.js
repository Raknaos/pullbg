/** Pixel pipelines: flood, interior punch, stamp v4. */

export function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function imageDataFromBitmap(bitmap, maxEdge = 0) {
  let w = bitmap.width;
  let h = bitmap.height;
  if (maxEdge > 0 && Math.max(w, h) > maxEdge) {
    const s = maxEdge / Math.max(w, h);
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(h * s));
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { canvas, ctx, image: ctx.getImageData(0, 0, w, h) };
}

export async function bitmapFromSource(source) {
  const opts = { imageOrientation: "from-image" };
  if (source instanceof ImageBitmap) return source;
  if (source instanceof Blob) return createImageBitmap(source, opts);
  if (typeof source === "string") {
    const res = await fetch(source);
    return createImageBitmap(await res.blob(), opts);
  }
  throw new Error("Source image invalide");
}

export function lumaMap(data, w, h) {
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) lum[p] = luminance(data[i], data[i + 1], data[i + 2]);
  return lum;
}

function connectedToBorder(mask, w, h) {
  const n = w * h;
  const out = new Uint8Array(n);
  const stack = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (!mask[i] || out[i]) return;
    out[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(x - 1, y);
    if (x + 1 < w) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < h) push(x, y + 1);
  }
  return out;
}

function labelInteriorLarge(mask, w, h, minFrac) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const keep = new Uint8Array(n);
  const minArea = Math.max(80, Math.floor(n * minFrac));
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const start = y * w + x;
      if (!mask[start] || seen[start]) continue;
      let head = 0;
      let tail = 0;
      let area = 0;
      let border = false;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
      seen[start] = 1;
      const cells = [];
      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        cells.push(cy * w + cx);
        area++;
        if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) border = true;
        const neigh = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (const [nx, ny] of neigh) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!mask[ni] || seen[ni]) continue;
          seen[ni] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }
      if (!border && area >= minArea) for (const i of cells) keep[i] = 1;
    }
  }
  return keep;
}

export function largestForeground(alpha, w, h, minA = 20) {
  const n = w * h;
  const seen = new Uint8Array(n);
  let best = null;
  let bestArea = 0;
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = y * w + x;
      if (alpha[s] < minA || seen[s]) continue;
      let head = 0;
      let tail = 0;
      let area = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
      seen[s] = 1;
      const cells = [];
      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        cells.push(cy * w + cx);
        area++;
        const neigh = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (const [nx, ny] of neigh) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (alpha[ni] < minA || seen[ni]) continue;
          seen[ni] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }
      if (area > bestArea) {
        bestArea = area;
        best = cells;
      }
    }
  }
  if (!best || bestArea < n * 0.01) return alpha;
  const out = new Uint8ClampedArray(n);
  for (const i of best) out[i] = alpha[i];
  return out;
}

function softAlphaFromBg(bg, w, h) {
  const n = w * h;
  const alpha = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) alpha[i] = bg[i] ? 0 : 255;
  const copy = alpha.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (copy[i] === 0) continue;
      let minN = 255;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = copy[(y + dy) * w + (x + dx)];
          if (v < minN) minN = v;
        }
      }
      if (minN === 0) alpha[i] = 150;
    }
  }
  return alpha;
}

export function applyAlpha(image, alpha) {
  const out = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  const d = out.data;
  for (let p = 0, i = 3; p < alpha.length; p++, i += 4) {
    const a = alpha[p];
    d[i] = Math.min(d[i], a);
    if (a < 6) {
      d[i - 3] = 0;
      d[i - 2] = 0;
      d[i - 1] = 0;
    }
  }
  return out;
}

export function alphaOf(image) {
  const a = new Uint8ClampedArray(image.width * image.height);
  const d = image.data;
  for (let p = 0, i = 3; i < d.length; p++, i += 4) a[p] = d[i];
  return a;
}

function canvasFromImageData(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d").putImageData(image, 0, 0);
  return canvas;
}

export function floodBlack(image, threshold = 26) {
  const { data, width: w, height: h } = image;
  const lum = lumaMap(data, w, h);
  const cand = new Uint8Array(w * h);
  for (let i = 0; i < cand.length; i++) cand[i] = lum[i] <= threshold ? 1 : 0;
  return applyAlpha(image, softAlphaFromBg(connectedToBorder(cand, w, h), w, h));
}

export function floodWhite(image, threshold = 22) {
  const { data, width: w, height: h } = image;
  const lum = lumaMap(data, w, h);
  const cand = new Uint8Array(w * h);
  for (let i = 0; i < cand.length; i++) {
    const o = i * 4;
    const dist = Math.max(Math.abs(data[o] - 255), Math.abs(data[o + 1] - 255), Math.abs(data[o + 2] - 255));
    cand[i] = lum[i] >= 245 - threshold && dist <= threshold + 8 ? 1 : 0;
  }
  return applyAlpha(image, softAlphaFromBg(connectedToBorder(cand, w, h), w, h));
}

export function punchInterior(image, prefer) {
  const { data, width: w, height: h } = image;
  const lum = lumaMap(data, w, h);
  const black = new Uint8Array(w * h);
  const white = new Uint8Array(w * h);
  for (let i = 0; i < lum.length; i++) {
    if (lum[i] <= 14) black[i] = 1;
    if (lum[i] >= 248) white[i] = 1;
  }
  const punchB = labelInteriorLarge(black, w, h, 0.08);
  const punchW = labelInteriorLarge(white, w, h, 0.08);
  let areaB = 0;
  let areaW = 0;
  for (let i = 0; i < punchB.length; i++) {
    if (punchB[i]) areaB++;
    if (punchW[i]) areaW++;
  }
  let use;
  if (prefer === "black" && areaB) use = punchB;
  else if (prefer === "white" && areaW) use = punchW;
  else use = areaB >= areaW ? punchB : punchW;
  return applyAlpha(image, softAlphaFromBg(use, w, h));
}

function findPeaks(signal, distance, prominence) {
  const peaks = [];
  const n = signal.length;
  for (let i = 1; i < n - 1; i++) {
    if (signal[i] < signal[i - 1] || signal[i] < signal[i + 1]) continue;
    let left = signal[i];
    let right = signal[i];
    for (let k = i - 1; k >= Math.max(0, i - distance * 3); k--) left = Math.min(left, signal[k]);
    for (let k = i + 1; k <= Math.min(n - 1, i + distance * 3); k++) right = Math.min(right, signal[k]);
    const prom = signal[i] - Math.max(left, right);
    if (prom < prominence) continue;
    if (!peaks.length || i - peaks[peaks.length - 1] >= distance) peaks.push(i);
    else if (signal[i] > signal[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
  }
  return peaks;
}

function refineHole(lum, w, h, x, y, scale) {
  const window = Math.max(5, Math.round(6 * scale));
  const x0 = Math.max(0, x - window);
  const x1 = Math.min(w, x + window + 1);
  const y0 = Math.max(0, y - window);
  const y1 = Math.min(h, y + window + 1);
  let min = 1e9;
  const vals = [];
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const v = lum[yy * w + xx];
      vals.push(v);
      if (v < min) min = v;
    }
  }
  vals.sort((a, b) => a - b);
  const cut = vals[Math.floor(vals.length * 0.32)] || min;
  const thr = Math.max(cut, min + 8);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      if (lum[yy * w + xx] <= thr) {
        sx += xx;
        sy += yy;
        n++;
      }
    }
  }
  if (n < 4) return { cx: x, cy: y, r: 3.2 * scale };
  const r = Math.min(7.2 * scale, Math.max(2.6 * scale, Math.sqrt(n / Math.PI) + 0.45 * scale));
  return { cx: sx / n, cy: sy / n, r };
}

function detectPrintedHoles(lum, w, h, scale = 1) {
  const strip = Math.max(10, Math.round(Math.min(w, h) * 0.05), Math.round(16 * scale));
  const distance = Math.max(6, Math.round(7 * scale));
  const holes = [];
  const collect = (signal, kind) => {
    let max = -1e9;
    let min = 1e9;
    for (let i = 0; i < signal.length; i++) {
      if (signal[i] > max) max = signal[i];
      if (signal[i] < min) min = signal[i];
    }
    const inv = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i++) inv[i] = max - signal[i];
    const prom = Math.max(10 * scale, 0.18 * (max - min));
    for (const p of findPeaks(inv, distance, prom)) {
      if (kind === "top") {
        let y = 0;
        let best = 1e9;
        for (let yy = 0; yy < strip; yy++) if (lum[yy * w + p] < best) { best = lum[yy * w + p]; y = yy; }
        holes.push(refineHole(lum, w, h, p, y, scale));
      } else if (kind === "bot") {
        let y = h - 1;
        let best = 1e9;
        for (let yy = h - strip; yy < h; yy++) if (lum[yy * w + p] < best) { best = lum[yy * w + p]; y = yy; }
        holes.push(refineHole(lum, w, h, p, y, scale));
      } else if (kind === "left") {
        let x = 0;
        let best = 1e9;
        for (let xx = 0; xx < strip; xx++) if (lum[p * w + xx] < best) { best = lum[p * w + xx]; x = xx; }
        holes.push(refineHole(lum, w, h, x, p, scale));
      } else {
        let x = w - 1;
        let best = 1e9;
        for (let xx = w - strip; xx < w; xx++) if (lum[p * w + xx] < best) { best = lum[p * w + xx]; x = xx; }
        holes.push(refineHole(lum, w, h, x, p, scale));
      }
    }
  };
  const top = new Float32Array(w);
  const bot = new Float32Array(w);
  const left = new Float32Array(h);
  const right = new Float32Array(h);
  top.fill(1e9); bot.fill(1e9); left.fill(1e9); right.fill(1e9);
  for (let y = 0; y < strip; y++) for (let x = 0; x < w; x++) if (lum[y * w + x] < top[x]) top[x] = lum[y * w + x];
  for (let y = h - strip; y < h; y++) for (let x = 0; x < w; x++) if (lum[y * w + x] < bot[x]) bot[x] = lum[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < strip; x++) if (lum[y * w + x] < left[y]) left[y] = lum[y * w + x];
    for (let x = w - strip; x < w; x++) if (lum[y * w + x] < right[y]) right[y] = lum[y * w + x];
  }
  collect(top, "top");
  collect(bot, "bot");
  collect(left, "left");
  collect(right, "right");
  return holes;
}

function punchHoles(alpha, w, h, holes) {
  for (const hole of holes) {
    const r = hole.r + 0.6;
    const r2 = r * r;
    const y0 = Math.max(0, Math.floor(hole.cy - r - 1));
    const y1 = Math.min(h - 1, Math.ceil(hole.cy + r + 1));
    const x0 = Math.max(0, Math.floor(hole.cx - r - 1));
    const x1 = Math.min(w - 1, Math.ceil(hole.cx + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - hole.cx;
        const dy = y - hole.cy;
        if (dx * dx + dy * dy <= r2) alpha[y * w + x] = 0;
      }
    }
  }
  return alpha;
}

function adaptiveDarkThreshold(lum, w, h) {
  const samples = [];
  for (let x = 0; x < w; x++) {
    samples.push(lum[x], lum[w + x], lum[(h - 1) * w + x], lum[(h - 2) * w + x]);
  }
  for (let y = 0; y < h; y++) {
    samples.push(lum[y * w], lum[y * w + 1], lum[y * w + w - 1], lum[y * w + w - 2]);
  }
  const dark = samples.filter((v) => v < 80);
  const pick = dark.length ? dark : samples;
  pick.sort((a, b) => a - b);
  const bg = pick[Math.floor(pick.length / 2)];
  return Math.min(78, Math.max(bg + 10, bg + 18));
}

export function stampCut(image) {
  const { data, width: w, height: h } = image;
  const lum = lumaMap(data, w, h);
  let borderDark = 0;
  let n = 0;
  const mark = (x, y) => {
    n++;
    if (lum[y * w + x] < 60) borderDark++;
  };
  for (let x = 0; x < w; x++) {
    mark(x, 0); mark(x, 1); mark(x, h - 1); mark(x, h - 2);
  }
  for (let y = 0; y < h; y++) {
    mark(0, y); mark(1, y); mark(w - 1, y); mark(w - 2, y);
  }
  const darkBackdrop = n && borderDark / n >= 0.25;
  const cand = new Uint8Array(w * h);
  if (darkBackdrop) {
    const thr = adaptiveDarkThreshold(lum, w, h);
    for (let i = 0; i < lum.length; i++) cand[i] = lum[i] <= thr ? 1 : 0;
  } else {
    for (let i = 0; i < lum.length; i++) {
      const o = i * 4;
      const dist = Math.max(Math.abs(data[o] - 255), Math.abs(data[o + 1] - 255), Math.abs(data[o + 2] - 255));
      cand[i] = lum[i] >= 209 && dist <= 44 ? 1 : 0;
    }
  }
  const bg = connectedToBorder(cand, w, h);
  const fg = new Uint8ClampedArray(w * h);
  for (let i = 0; i < fg.length; i++) fg[i] = bg[i] ? 0 : 255;
  const scale = Math.max(1, Math.min(w, h) / 480);
  punchHoles(fg, w, h, detectPrintedHoles(lum, w, h, scale));
  const kept = largestForeground(fg, w, h, 1);
  return applyAlpha(image, kept);
}

export function decontaminate(image) {
  const { data, width: w, height: h } = image;
  const out = new ImageData(new Uint8ClampedArray(data), w, h);
  const d = out.data;
  let br = 0;
  let bg = 0;
  let bb = 0;
  let bn = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] >= 12) continue;
      const edge =
        (x > 0 && data[((y * w + x - 1) * 4) + 3] > 40) ||
        (x + 1 < w && data[((y * w + x + 1) * 4) + 3] > 40) ||
        (y > 0 && data[(((y - 1) * w + x) * 4) + 3] > 40) ||
        (y + 1 < h && data[(((y + 1) * w + x) * 4) + 3] > 40);
      if (!edge) continue;
      br += data[i];
      bg += data[i + 1];
      bb += data[i + 2];
      bn++;
    }
  }
  if (bn < 8) return out;
  br /= bn; bg /= bn; bb /= bn;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a <= 0.03 || a >= 0.97) continue;
    d[i] = Math.max(0, Math.min(255, (d[i] - (1 - a) * br) / Math.max(a, 1e-4)));
    d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] - (1 - a) * bg) / Math.max(a, 1e-4)));
    d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] - (1 - a) * bb) / Math.max(a, 1e-4)));
  }
  return out;
}

export function scoreCut(image) {
  const { data, width: w, height: h } = image;
  const n = w * h;
  let trans = 0;
  let borderTrans = 0;
  let borderN = 0;
  let centerKeep = 0;
  let centerN = 0;
  const x0 = Math.floor(w * 0.3);
  const x1 = Math.floor(w * 0.7);
  const y0 = Math.floor(h * 0.3);
  const y1 = Math.floor(h * 0.7);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      const t = a < 16;
      if (t) trans++;
      const border = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      if (border) {
        borderN++;
        if (t) borderTrans++;
      }
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        centerN++;
        if (a > 80) centerKeep++;
      }
    }
  }
  const tr = trans / n;
  const br = borderN ? borderTrans / borderN : 0;
  const ck = centerN ? centerKeep / centerN : 0;
  if (tr < 0.015) return { score: 0.05, why: "rien enlevé", tr, br, ck };
  if (tr > 0.94) return { score: 0.08, why: "tout mangé", tr, br, ck };
  if (ck < 0.18) return { score: 0.12, why: "sujet troué", tr, br, ck };
  const score = 0.35 * Math.min(tr, 0.55) / 0.55 + 0.35 * br + 0.3 * ck;
  return { score, why: "ok", tr, br, ck };
}

export function protectSubject(iaImage, geoImage) {
  const w = iaImage.width;
  const h = iaImage.height;
  const out = new ImageData(new Uint8ClampedArray(iaImage.data), w, h);
  const ia = iaImage.data;
  const geo = geoImage.data;
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const iaA = ia[i + 3];
    const geoA = geo[i + 3];
    if (iaA < 20 && geoA > 180) {
      d[i] = geo[i];
      d[i + 1] = geo[i + 1];
      d[i + 2] = geo[i + 2];
      d[i + 3] = geoA;
    } else if (iaA > 180 && geoA < 20) {
      d[i + 3] = 0;
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
    }
  }
  return out;
}

export function fillInteriorHoles(image, maxFrac = 0.012) {
  const { width: w, height: h } = image;
  const a = alphaOf(image);
  const hole = new Uint8Array(w * h);
  for (let i = 0; i < hole.length; i++) hole[i] = a[i] < 20 ? 1 : 0;
  const interior = labelInteriorLarge(hole, w, h, 0.0004);
  const maxArea = Math.floor(w * h * maxFrac);
  const out = a.slice();
  const seen = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const s = y * w + x;
      if (!interior[s] || seen[s]) continue;
      let head = 0;
      let tail = 0;
      const cells = [];
      qx[tail] = x; qy[tail] = y; tail++; seen[s] = 1;
      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        cells.push(cy * w + cx);
        const neigh = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (const [nx, ny] of neigh) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!interior[ni] || seen[ni]) continue;
          seen[ni] = 1;
          qx[tail] = nx; qy[tail] = ny; tail++;
        }
      }
      if (cells.length <= maxArea) for (const i of cells) out[i] = 255;
    }
  }
  return applyAlpha(image, out);
}

export function cleanupSpeckles(image) {
  const a = alphaOf(image);
  const cleaned = largestForeground(a, image.width, image.height, 18);
  return applyAlpha(image, cleaned);
}

export async function blobFromImageData(image) {
  const canvas = canvasFromImageData(image);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export async function blobFromImageDataBlurred(image, amount = 18) {
  const src = canvasFromImageData(image);
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d");
  ctx.filter = `blur(${amount}px)`;
  ctx.drawImage(src, 0, 0);
  ctx.filter = "none";
  ctx.fillStyle = "rgba(10,10,12,0.28)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export function previewUrlFromImageData(image) {
  return canvasFromImageData(image).toDataURL("image/png");
}
