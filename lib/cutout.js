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
  const image = ctx.getImageData(0, 0, w, h);
  if (typeof bitmap.close === "function") bitmap.close();
  return { canvas, ctx, image };
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

function labelInteriorLarge(mask, w, h, minFrac, minFill = 0) {
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
      let x0 = x;
      let y0 = y;
      let x1 = x;
      let y1 = y;
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
        if (cx < x0) x0 = cx;
        if (cy < y0) y0 = cy;
        if (cx > x1) x1 = cx;
        if (cy > y1) y1 = cy;
        if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) border = true;
        const neigh = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
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
      if (border || area < minArea) continue;
      if (minFill > 0) {
        const bw = x1 - x0 + 1;
        const bh = y1 - y0 + 1;
        const bbox = bw * bh;
        const fill = bbox ? area / bbox : 0;
        const aspect = bw >= bh ? bw / bh : bh / bw;
        const emptyTL = !mask[y0 * w + x0];
        const emptyTR = !mask[y0 * w + x1];
        const emptyBL = !mask[y1 * w + x0];
        const emptyBR = !mask[y1 * w + x1];
        const emptyN = (emptyTL ? 1 : 0) + (emptyTR ? 1 : 0) + (emptyBL ? 1 : 0) + (emptyBR ? 1 : 0);
        const lozenge = fill >= 0.36 && fill < 0.68 && aspect <= 2.2 && emptyN === 4;
        const triangle = fill >= 0.42 && fill < 0.68 && aspect <= 2.2 && emptyN === 2
          && ((emptyTL && emptyTR) || (emptyBL && emptyBR) || (emptyTL && emptyBL) || (emptyTR && emptyBR));
        if (!bbox || (fill < minFill && !lozenge && !triangle)) continue;
      }
      for (const i of cells) keep[i] = 1;
    }
  }
  return keep;
}

export function largestForeground(alpha, w, h, minA = 20) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const parts = [];
  let bestArea = 0;
  const floor = Math.max(80, Math.floor(n * 0.006));
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = y * w + x;
      if (alpha[s] < minA || seen[s]) continue;
      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
      seen[s] = 1;
      const cells = [];
      let border = false;
      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        cells.push(cy * w + cx);
        if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) border = true;
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
      if (cells.length < floor) continue;
      parts.push({ cells, interior: !border });
      if (cells.length > bestArea) bestArea = cells.length;
    }
  }
  if (bestArea < n * 0.01) return alpha;
  const minKeep = Math.max(floor, Math.floor(bestArea * 0.1));
  const out = new Uint8ClampedArray(n);
  for (const part of parts) {
    if (part.cells.length < minKeep && !(part.interior && part.cells.length >= floor)) continue;
    for (const i of part.cells) out[i] = alpha[i];
  }
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

function scaleImage(image, w, h) {
  if (image.width === w && image.height === h) return image;
  const src = canvasFromImageData(image);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function chromaCut(image, low = 20, high = 70) {
  const { data, width: w, height: h } = image;
  const alpha = new Uint8ClampedArray(w * h);
  const span = Math.max(1, high - low);
  for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
    const chroma = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    let t = Math.max(0, Math.min(1, (chroma - low) / span));
    t = t * t * (3 - 2 * t);
    alpha[p] = Math.round(255 * t);
  }
  return applyAlpha(image, largestForeground(alpha, w, h, 18));
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

function cornerSeeds(data, w, h, patch = 4, agree = 40) {
  const mean = (x0, y0) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const x1 = Math.min(w, x0 + patch);
    const y1 = Math.min(h, y0 + patch);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
    }
    return [r / n, g / n, b / n];
  };
  const corners = [
    mean(0, 0),
    mean(Math.max(0, w - patch), 0),
    mean(0, Math.max(0, h - patch)),
    mean(Math.max(0, w - patch), Math.max(0, h - patch)),
  ];
  const keep = [];
  for (let i = 0; i < 4; i++) {
    let near = 0;
    for (let j = 0; j < 4; j++) {
      const d = Math.max(
        Math.abs(corners[i][0] - corners[j][0]),
        Math.abs(corners[i][1] - corners[j][1]),
        Math.abs(corners[i][2] - corners[j][2]),
      );
      if (d <= agree) near++;
    }
    if (near >= 2) keep.push(corners[i]);
  }
  return keep.length ? keep : corners;
}

function distToSeeds(data, i, seeds) {
  let best = 1e9;
  for (const s of seeds) {
    const d = Math.max(
      Math.abs(data[i] - s[0]),
      Math.abs(data[i + 1] - s[1]),
      Math.abs(data[i + 2] - s[2]),
    );
    if (d < best) best = d;
  }
  return best;
}

export function floodColor(image, maxDist = 32, maxStep = 18) {
  const { data, width: w, height: h } = image;
  const seeds = cornerSeeds(data, w, h);
  const n = w * h;
  const bg = new Uint8Array(n);
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const seed = (x, y) => {
    const p = y * w + x;
    if (bg[p]) return;
    if (distToSeeds(data, p * 4, seeds) > maxDist) return;
    bg[p] = 1;
    qx[tail] = x;
    qy[tail] = y;
    tail++;
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }
  while (head < tail) {
    const cx = qx[head];
    const cy = qy[head];
    head++;
    const ci = (cy * w + cx) * 4;
    const neigh = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
    for (const [nx, ny] of neigh) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const p = ny * w + nx;
      if (bg[p]) continue;
      const o = p * 4;
      const step = Math.max(
        Math.abs(data[o] - data[ci]),
        Math.abs(data[o + 1] - data[ci + 1]),
        Math.abs(data[o + 2] - data[ci + 2]),
      );
      if (step > maxStep) continue;
      bg[p] = 1;
      qx[tail] = nx;
      qy[tail] = ny;
      tail++;
    }
  }
  return applyAlpha(image, softAlphaFromBg(bg, w, h));
}

export function punchInterior(image, prefer) {
  const { data, width: w, height: h } = image;
  const lum = lumaMap(data, w, h);
  let borderSum = 0;
  let borderN = 0;
  let borderR = 0;
  let borderG = 0;
  let borderB = 0;
  const edge = (x, y) => {
    const i = y * w + x;
    const o = i * 4;
    borderSum += lum[i];
    borderR += data[o];
    borderG += data[o + 1];
    borderB += data[o + 2];
    borderN++;
  };
  for (let x = 0; x < w; x++) {
    edge(x, 0);
    edge(x, 1);
    edge(x, h - 1);
    edge(x, h - 2);
  }
  for (let y = 0; y < h; y++) {
    edge(0, y);
    edge(1, y);
    edge(w - 1, y);
    edge(w - 2, y);
  }
  const borderMean = borderSum / borderN;
  borderR /= borderN;
  borderG /= borderN;
  borderB /= borderN;
  const paneBlack = Math.max(14, Math.min(50, borderMean - 8));
  const paneWhite = Math.min(248, Math.max(234, borderMean + 40));
  const black = new Uint8Array(w * h);
  const white = new Uint8Array(w * h);
  const mid = new Uint8Array(w * h);
  const tint = new Uint8Array(w * h);
  for (let i = 0; i < lum.length; i++) {
    const o = i * 4;
    if (lum[i] <= paneBlack) black[i] = 1;
    else if (lum[i] >= paneWhite) white[i] = 1;
    else if (Math.abs(lum[i] - borderMean) >= 16) mid[i] = 1;
    const dist = Math.max(
      Math.abs(data[o] - borderR),
      Math.abs(data[o + 1] - borderG),
      Math.abs(data[o + 2] - borderB),
    );
    if (dist >= 16 && lum[i] < paneWhite) tint[i] = 1;
  }
  const punchB = labelInteriorLarge(black, w, h, 0.004, 0.68);
  const punchW = labelInteriorLarge(white, w, h, 0.004, 0.68);
  const punchM = labelInteriorLarge(mid, w, h, 0.004, 0.68);
  const punchT = labelInteriorLarge(tint, w, h, 0.004, 0.68);
  let areaB = 0;
  let areaW = 0;
  let areaM = 0;
  let areaT = 0;
  for (let i = 0; i < punchB.length; i++) {
    if (punchB[i]) areaB++;
    if (punchW[i]) areaW++;
    if (punchM[i]) areaM++;
    if (punchT[i]) areaT++;
  }
  let use;
  if (prefer === "black" && (areaB || areaM || areaT)) {
    const merged = new Uint8Array(w * h);
    for (let i = 0; i < merged.length; i++) {
      if (punchB[i] || punchM[i] || punchT[i]) merged[i] = 1;
    }
    use = merged;
  } else if (prefer === "white" && areaW) {
    use = punchW;
  } else {
    use = areaB >= areaW && areaB >= areaM && areaB >= areaT
      ? punchB
      : areaW >= areaM && areaW >= areaT
        ? punchW
        : areaM >= areaT
          ? punchM
          : punchT;
  }
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

function detectPrintedHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw < 24 || rh < 24) return [];
  const strip = Math.max(10, Math.round(Math.min(rw, rh) * 0.05), Math.round(16 * scale));
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
        const x = x0 + p;
        let y = y0;
        let best = 1e9;
        for (let yy = y0; yy < Math.min(y1, y0 + strip); yy++) if (lum[yy * w + x] < best) { best = lum[yy * w + x]; y = yy; }
        holes.push(refineHole(lum, w, h, x, y, scale));
      } else if (kind === "bot") {
        const x = x0 + p;
        let y = y1 - 1;
        let best = 1e9;
        for (let yy = Math.max(y0, y1 - strip); yy < y1; yy++) if (lum[yy * w + x] < best) { best = lum[yy * w + x]; y = yy; }
        holes.push(refineHole(lum, w, h, x, y, scale));
      } else if (kind === "left") {
        const y = y0 + p;
        let x = x0;
        let best = 1e9;
        for (let xx = x0; xx < Math.min(x1, x0 + strip); xx++) if (lum[y * w + xx] < best) { best = lum[y * w + xx]; x = xx; }
        holes.push(refineHole(lum, w, h, x, y, scale));
      } else {
        const y = y0 + p;
        let x = x1 - 1;
        let best = 1e9;
        for (let xx = Math.max(x0, x1 - strip); xx < x1; xx++) if (lum[y * w + xx] < best) { best = lum[y * w + xx]; x = xx; }
        holes.push(refineHole(lum, w, h, x, y, scale));
      }
    }
  };
  const top = new Float32Array(rw);
  const bot = new Float32Array(rw);
  const left = new Float32Array(rh);
  const right = new Float32Array(rh);
  top.fill(1e9); bot.fill(1e9); left.fill(1e9); right.fill(1e9);
  for (let y = y0; y < Math.min(y1, y0 + strip); y++) {
    for (let x = x0; x < x1; x++) if (lum[y * w + x] < top[x - x0]) top[x - x0] = lum[y * w + x];
  }
  for (let y = Math.max(y0, y1 - strip); y < y1; y++) {
    for (let x = x0; x < x1; x++) if (lum[y * w + x] < bot[x - x0]) bot[x - x0] = lum[y * w + x];
  }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < Math.min(x1, x0 + strip); x++) if (lum[y * w + x] < left[y - y0]) left[y - y0] = lum[y * w + x];
    for (let x = Math.max(x0, x1 - strip); x < x1; x++) if (lum[y * w + x] < right[y - y0]) right[y - y0] = lum[y * w + x];
  }
  collect(top, "top");
  collect(bot, "bot");
  collect(left, "left");
  collect(right, "right");
  return holes;
}

function punchHoles(alpha, lum, w, h, holes) {
  for (const hole of holes) {
    const hardR = hole.r + 0.25;
    const softR = hole.r + 1.25;
    const haloR = hole.r + 2;
    const y0 = Math.max(0, Math.floor(hole.cy - haloR - 1));
    const y1 = Math.min(h - 1, Math.ceil(hole.cy + haloR + 1));
    const x0 = Math.max(0, Math.floor(hole.cx - haloR - 1));
    const x1 = Math.min(w - 1, Math.ceil(hole.cx + haloR + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - hole.cx;
        const dy = y - hole.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = y * w + x;
        if (dist <= hardR) {
          alpha[i] = 0;
        } else if (dist <= softR) {
          const t = (dist - hardR) / (softR - hardR);
          const faded = Math.round(255 * t);
          if (alpha[i] > faded) alpha[i] = faded;
        } else if (dist <= haloR && lum[i] < 55) {
          alpha[i] = 0;
        }
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

function stampRectFromHoles(holes, w, h) {
  if (holes.length < 10) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const hole of holes) {
    if (hole.cx < minX) minX = hole.cx;
    if (hole.cy < minY) minY = hole.cy;
    if (hole.cx > maxX) maxX = hole.cx;
    if (hole.cy > maxY) maxY = hole.cy;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX < 24 || spanY < 24) return null;
  const top = [];
  const bot = [];
  const left = [];
  const right = [];
  const ys = minY + spanY * 0.12;
  const ye = minY + spanY * 0.88;
  const xs = minX + spanX * 0.12;
  const xe = minX + spanX * 0.88;
  for (const hole of holes) {
    if (hole.cy <= ys) top.push(hole);
    if (hole.cy >= ye) bot.push(hole);
    if (hole.cx <= xs) left.push(hole);
    if (hole.cx >= xe) right.push(hole);
  }
  const enough = (side) => side.length >= 5;
  if (!(enough(top) && enough(bot)) && !(enough(left) && enough(right))) return null;
  const med = (side, key) => {
    const vals = side.map((hole) => hole[key]).sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  };
  let x0 = Math.max(0, minX - 1.2);
  let y0 = Math.max(0, minY - 1.2);
  let x1 = Math.min(w, maxX + 1.2);
  let y1 = Math.min(h, maxY + 1.2);
  if (enough(left)) x0 = Math.max(0, med(left, "cx") - 1.2);
  if (enough(right)) x1 = Math.min(w, med(right, "cx") + 1.2);
  if (enough(top)) y0 = Math.max(0, med(top, "cy") - 1.2);
  if (enough(bot)) y1 = Math.min(h, med(bot, "cy") + 1.2);
  if (x1 - x0 < spanX * 0.55 || y1 - y0 < spanY * 0.55) return null;
  return { x0, y0, x1, y1 };
}

function opaqueParts(alpha, w, h) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  const parts = [];
  let bestArea = 0;
  const floor = Math.max(80, Math.floor(n * 0.006));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = y * w + x;
      if (alpha[s] < 20 || seen[s]) continue;
      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
      seen[s] = 1;
      let x0 = x;
      let y0 = y;
      let x1 = x;
      let y1 = y;
      let area = 0;
      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        area++;
        if (cx < x0) x0 = cx;
        if (cy < y0) y0 = cy;
        if (cx > x1) x1 = cx;
        if (cy > y1) y1 = cy;
        const neigh = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
        for (const [nx, ny] of neigh) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (alpha[ni] < 20 || seen[ni]) continue;
          seen[ni] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }
      if (area < floor) continue;
      parts.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, area });
      if (area > bestArea) bestArea = area;
    }
  }
  const minKeep = Math.max(floor, Math.floor(bestArea * 0.1));
  return parts.filter((p) => p.area >= minKeep);
}

function holePad(box) {
  return Math.max(12, Math.round(Math.min(box.x1 - box.x0, box.y1 - box.y0) * 0.35));
}

function expandBox(box, w, h, pad) {
  return {
    x0: Math.max(0, box.x0 - pad),
    y0: Math.max(0, box.y0 - pad),
    x1: Math.min(w, box.x1 + pad),
    y1: Math.min(h, box.y1 + pad),
  };
}

function holeNearBox(hole, box, pad) {
  return hole.cx >= box.x0 - pad && hole.cx <= box.x1 + pad && hole.cy >= box.y0 - pad && hole.cy <= box.y1 + pad;
}

function sampleRingMin(lum, w, h, cx, cy, r) {
  const n = Math.max(48, Math.round(2 * Math.PI * r));
  const sig = new Float32Array(n);
  const band = Math.max(2, Math.min(5, Math.round(r * 0.05)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let best = 1e9;
    for (let dr = -band; dr <= band; dr++) {
      const x = Math.round(cx + (r + dr) * ca);
      const y = Math.round(cy + (r + dr) * sa);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const v = lum[y * w + x];
      if (v < best) best = v;
    }
    sig[i] = best === 1e9 ? 255 : best;
  }
  return sig;
}

function ringValleyIndexes(sig) {
  const win = 6;
  const idxs = [];
  for (let i = win; i < sig.length - win; i++) {
    const valley = sig[i];
    if (valley > 78) continue;
    const neigh = Math.min(sig[i - win], sig[i + win]);
    if (neigh - valley < 18) continue;
    if (idxs.length && i - idxs[idxs.length - 1] < 6) continue;
    idxs.push(i);
  }
  return idxs;
}

function detectRingHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rMax = Math.min(cx - x0, x1 - cx, cy - y0, y1 - cy);
  if (rMax < 16) return [];
  const step = Math.max(2, Math.round(rMax * 0.06));
  let bestR = 0;
  let bestIdxs = [];
  for (let r = Math.max(16, Math.round(rMax * 0.55)); r <= rMax; r += step) {
    const idxs = ringValleyIndexes(sampleRingMin(lum, w, h, cx, cy, r));
    if (idxs.length > bestIdxs.length) {
      bestIdxs = idxs;
      bestR = r;
    }
  }
  if (bestIdxs.length < 12) return [];
  const n = Math.max(48, Math.round(2 * Math.PI * bestR));
  const holes = [];
  for (const p of bestIdxs) {
    const a = (p / n) * Math.PI * 2;
    const x = Math.round(cx + bestR * Math.cos(a));
    const y = Math.round(cy + bestR * Math.sin(a));
    holes.push(refineHole(lum, w, h, x, y, scale));
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function stampDiskFromHoles(holes) {
  if (holes.length < 12) return null;
  let sx = 0;
  let sy = 0;
  for (const hole of holes) {
    sx += hole.cx;
    sy += hole.cy;
  }
  const cx = sx / holes.length;
  const cy = sy / holes.length;
  const radii = holes.map((hole) => Math.hypot(hole.cx - cx, hole.cy - cy)).sort((a, b) => a - b);
  const r = radii[radii.length >> 1];
  if (r < 16) return null;
  let sum = 0;
  for (const ri of radii) sum += ri;
  const mean = sum / radii.length;
  let v = 0;
  for (const ri of radii) v += (ri - mean) * (ri - mean);
  if (Math.sqrt(v / radii.length) / mean > 0.08) return null;
  const tol = r * 0.1;
  let inliers = 0;
  for (const ri of radii) if (Math.abs(ri - r) <= tol) inliers++;
  if (inliers < 12 || inliers < holes.length * 0.8) return null;
  return { cx, cy, r: r + 1.2 };
}

function keepHoleDisk(lum, holes, disk, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const r2 = disk.r * disk.r;
  const x0 = Math.max(0, Math.floor(disk.cx - disk.r - 1));
  const x1 = Math.min(w - 1, Math.ceil(disk.cx + disk.r + 1));
  const y0 = Math.max(0, Math.floor(disk.cy - disk.r - 1));
  const y1 = Math.min(h - 1, Math.ceil(disk.cy + disk.r + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - disk.cx;
      const dy = y - disk.cy;
      if (dx * dx + dy * dy <= r2) alpha[y * w + x] = 255;
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function lightMarginEaten(alpha, lum, rect, w, h) {
  let lightGone = 0;
  let darkGone = 0;
  let area = 0;
  const x0 = Math.max(0, Math.floor(rect.x0));
  const y0 = Math.max(0, Math.floor(rect.y0));
  const x1 = Math.min(w, Math.ceil(rect.x1));
  const y1 = Math.min(h, Math.ceil(rect.y1));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      area++;
      const i = y * w + x;
      if (alpha[i] >= 20) continue;
      if (lum[i] >= 160) lightGone++;
      else darkGone++;
    }
  }
  return area > 0 && lightGone >= area * 0.06 && lightGone > darkGone * 2;
}

function keepHoleRect(lum, holes, rect, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const x0 = Math.max(0, Math.floor(rect.x0));
  const y0 = Math.max(0, Math.floor(rect.y0));
  const x1 = Math.min(w, Math.ceil(rect.x1));
  const y1 = Math.min(h, Math.ceil(rect.y1));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) alpha[y * w + x] = 255;
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function lightPaperMask(data, lum, w, h, cand) {
  let pr = 0;
  let pg = 0;
  let pb = 0;
  let pn = 0;
  const acc = (x, y) => {
    if (lum[y * w + x] < 70) return;
    const o = (y * w + x) * 4;
    pr += data[o];
    pg += data[o + 1];
    pb += data[o + 2];
    pn++;
  };
  for (let x = 0; x < w; x++) {
    acc(x, 0);
    acc(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    acc(0, y);
    acc(w - 1, y);
  }
  if (pn < 12) {
    for (let i = 0; i < lum.length; i++) {
      const o = i * 4;
      const dist = Math.max(Math.abs(data[o] - 255), Math.abs(data[o + 1] - 255), Math.abs(data[o + 2] - 255));
      cand[i] = lum[i] >= 209 && dist <= 44 ? 1 : 0;
    }
    return;
  }
  pr /= pn;
  pg /= pn;
  pb /= pn;
  const paperLum = luminance(pr, pg, pb);
  const colored = paperLum < 180;
  const distMax = colored ? 28 : 42;
  const floor = colored ? Math.max(40, paperLum - 28) : Math.min(200, paperLum - 26);
  const ceil = colored ? paperLum + 32 : 255;
  for (let i = 0; i < lum.length; i++) {
    const o = i * 4;
    const dist = Math.max(Math.abs(data[o] - pr), Math.abs(data[o + 1] - pg), Math.abs(data[o + 2] - pb));
    cand[i] = lum[i] >= floor && lum[i] <= ceil && dist <= distMax ? 1 : 0;
  }
}

export function stampCut(image) {
  const { data, width: w, height: h } = image;
  const lum = lumaMap(data, w, h);
  let borderDark = 0;
  let n = 0;
  const samples = [];
  const mark = (x, y) => {
    n++;
    const v = lum[y * w + x];
    samples.push(v);
    if (v < 60) borderDark++;
  };
  for (let x = 0; x < w; x++) {
    mark(x, 0); mark(x, 1); mark(x, h - 1); mark(x, h - 2);
  }
  for (let y = 0; y < h; y++) {
    mark(0, y); mark(1, y); mark(w - 1, y); mark(w - 2, y);
  }
  samples.sort((a, b) => a - b);
  const median = samples[samples.length >> 1];
  const darkBackdrop = n && borderDark / n >= 0.25 && median < 80;
  const cand = new Uint8Array(w * h);
  if (darkBackdrop) {
    const thr = adaptiveDarkThreshold(lum, w, h);
    for (let i = 0; i < lum.length; i++) cand[i] = lum[i] <= thr ? 1 : 0;
  } else {
    lightPaperMask(data, lum, w, h, cand);
  }
  const bg = connectedToBorder(cand, w, h);
  const fg = new Uint8ClampedArray(w * h);
  let kept = 0;
  for (let i = 0; i < fg.length; i++) {
    if (!bg[i]) {
      fg[i] = 255;
      kept++;
    }
  }
  if (kept < w * h * 0.08) fg.fill(255);
  const scale = Math.max(1, Math.min(w, h) / 480);
  const edgeHoles = detectPrintedHoles(lum, w, h, scale);
  const ringHoles = detectRingHoles(lum, w, h, scale);
  const holes = edgeHoles.concat(ringHoles);
  const parts = opaqueParts(fg, w, h);
  const partHoles = parts.map(() => []);
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    const pad = holePad(part);
    const search = expandBox(part, w, h, pad);
    if (search.x0 <= 0 && search.y0 <= 0 && search.x1 >= w && search.y1 >= h) continue;
    const inset = part.x0 > 6 && part.y0 > 6 && part.x1 < w - 6 && part.y1 < h - 6;
    const localScale = Math.max(0.75, Math.min(search.x1 - search.x0, search.y1 - search.y0) / 480);
    const local = detectPrintedHoles(lum, w, h, localScale, search).concat(
      detectRingHoles(lum, w, h, localScale, search),
    );
    for (const hole of local) {
      if (!holeNearBox(hole, part, pad)) continue;
      if (inset && (hole.cx <= 3 || hole.cy <= 3 || hole.cx >= w - 4 || hole.cy >= h - 4)) continue;
      holes.push(hole);
      partHoles[p].push(hole);
    }
  }
  punchHoles(fg, lum, w, h, holes);
  const body = largestForeground(fg, w, h, 1);
  let alpha = body;
  const coversOther = (rect, self) => {
    for (const part of parts) {
      if (part === self) continue;
      const cx = (part.x0 + part.x1) / 2;
      const cy = (part.y0 + part.y1) / 2;
      if (cx >= rect.x0 && cx < rect.x1 && cy >= rect.y0 && cy < rect.y1) return true;
    }
    return false;
  };
  const paintMask = (restored) => {
    if (alpha === body) alpha = body.slice();
    for (let i = 0; i < alpha.length; i++) if (restored[i] > alpha[i]) alpha[i] = restored[i];
  };
  const paintRect = (rect, localHoles, self) => {
    if (!rect || !lightMarginEaten(body, lum, rect, w, h)) return;
    if (self && coversOther(rect, self)) return;
    paintMask(keepHoleRect(lum, localHoles, rect, w, h));
  };
  const paintDisk = (disk, localHoles, self) => {
    if (!disk) return false;
    const box = {
      x0: disk.cx - disk.r,
      y0: disk.cy - disk.r,
      x1: disk.cx + disk.r,
      y1: disk.cy + disk.r,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleDisk(lum, localHoles, disk, w, h));
    return true;
  };
  const paintPiece = (localHoles, self) => {
    if (paintDisk(stampDiskFromHoles(localHoles), localHoles, self)) return;
    paintRect(stampRectFromHoles(localHoles, w, h), localHoles, self);
  };
  if (parts.length < 2) paintPiece(edgeHoles.concat(ringHoles), null);
  for (let p = 0; p < parts.length; p++) {
    paintPiece(partHoles[p], parts[p]);
  }
  return applyAlpha(image, alpha);
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
  const trimWeakAlpha = () => {
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] >= 12) continue;
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
    }
  };
  if (bn < 8) {
    trimWeakAlpha();
    return out;
  }
  br /= bn; bg /= bn; bb /= bn;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a <= 0.03 || a >= 0.97) continue;
    d[i] = Math.max(0, Math.min(255, (d[i] - (1 - a) * br) / Math.max(a, 1e-4)));
    d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] - (1 - a) * bg) / Math.max(a, 1e-4)));
    d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] - (1 - a) * bb) / Math.max(a, 1e-4)));
  }
  trimWeakAlpha();
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
  let iaImg = iaImage;
  let geoImg = geoImage;
  if (iaImg.width !== geoImg.width || iaImg.height !== geoImg.height) {
    geoImg = scaleImage(geoImg, iaImg.width, iaImg.height);
  }
  const w = iaImg.width;
  const h = iaImg.height;
  const out = new ImageData(new Uint8ClampedArray(iaImg.data), w, h);
  const ia = iaImg.data;
  const geo = geoImg.data;
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
