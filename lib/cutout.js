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

function sampleRingMin(lum, w, h, cx, cy, rx, ry = rx) {
  const n = Math.max(48, Math.round(Math.PI * (rx + ry)));
  const sig = new Float32Array(n);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let best = 1e9;
    for (let dr = -band; dr <= band; dr++) {
      const x = Math.round(cx + (rx + dr) * ca);
      const y = Math.round(cy + (ry + dr) * sa);
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

function closedValleyIndexes(sig) {
  const win = 6;
  const n = sig.length;
  const idxs = [];
  if (n < win * 2 + 8) return idxs;
  for (let i = 0; i < n; i++) {
    const valley = sig[i];
    if (valley > 78) continue;
    const neigh = Math.min(sig[(i - win + n) % n], sig[(i + win) % n]);
    if (neigh - valley < 18) continue;
    if (idxs.length && i - idxs[idxs.length - 1] < 6) continue;
    idxs.push(i);
  }
  if (idxs.length >= 2 && idxs[0] + n - idxs[idxs.length - 1] < 6) idxs.pop();
  return idxs;
}

function holesOnEllipse(lum, w, h, cx, cy, rx, ry, idxs, n, scale) {
  const holes = [];
  for (const p of idxs) {
    const a = (p / n) * Math.PI * 2;
    const x = Math.round(cx + rx * Math.cos(a));
    const y = Math.round(cy + ry * Math.sin(a));
    holes.push(refineHole(lum, w, h, x, y, scale));
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectEllipseFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    const sig = sampleRingMin(lum, w, h, cx, cy, rx, ry);
    const idxs = ringValleyIndexes(sig);
    if (idxs.length > bestIdxs.length) {
      bestIdxs = idxs;
      bestRx = rx;
      bestRy = ry;
      bestN = sig.length;
    }
  }
  if (bestIdxs.length < 12) return [];
  return holesOnEllipse(lum, w, h, cx, cy, bestRx, bestRy, bestIdxs, bestN, scale);
}

function sampleDiamondMin(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const perSide = Math.max(12, Math.round(rx + ry));
  const sig = new Float32Array(perSide * 4);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  const verts = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
  let k = 0;
  for (let s = 0; s < 4; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 4][0];
    const y1 = verts[(s + 1) % 4][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnDiamond(lum, w, h, cx, cy, rx, ry, idxs, n, scale) {
  const perSide = n / 4;
  const verts = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 4;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 4][0];
    const y1 = verts[(s + 1) % 4][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    holes.push(refineHole(lum, w, h, x, y, scale));
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectDiamondFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    const sig = sampleDiamondMin(lum, w, h, cx, cy, rx, ry);
    const idxs = closedValleyIndexes(sig);
    if (idxs.length > bestIdxs.length) {
      bestIdxs = idxs;
      bestRx = rx;
      bestRy = ry;
      bestN = sig.length;
    }
  }
  if (bestIdxs.length < 12) return [];
  return holesOnDiamond(lum, w, h, cx, cy, bestRx, bestRy, bestIdxs, bestN, scale);
}

function hexagonVerts(cx, cy, rx, ry, flat) {
  return flat
    ? [[cx + rx, cy], [cx + rx * 0.5, cy + ry], [cx - rx * 0.5, cy + ry], [cx - rx, cy], [cx - rx * 0.5, cy - ry], [cx + rx * 0.5, cy - ry]]
    : [[cx, cy - ry], [cx + rx, cy - ry * 0.5], [cx + rx, cy + ry * 0.5], [cx, cy + ry], [cx - rx, cy + ry * 0.5], [cx - rx, cy - ry * 0.5]];
}

function sampleHexagonMin(lum, w, h, cx, cy, rx, ry, flat) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = hexagonVerts(cx, cy, rx, ry, flat);
  const perSide = Math.max(12, Math.round((rx + ry) * 0.7));
  const sig = new Float32Array(perSide * 6);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  let k = 0;
  for (let s = 0; s < 6; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 6][0];
    const y1 = verts[(s + 1) % 6][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnHexagon(lum, w, h, cx, cy, rx, ry, flat, idxs, n, scale) {
  const perSide = n / 6;
  const verts = hexagonVerts(cx, cy, rx, ry, flat);
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 6;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 6][0];
    const y1 = verts[(s + 1) % 6][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    holes.push(refineHole(lum, w, h, x, y, scale));
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectHexagonFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestFlat = false;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    for (const flat of [false, true]) {
      const sig = sampleHexagonMin(lum, w, h, cx, cy, rx, ry, flat);
      const idxs = closedValleyIndexes(sig);
      if (idxs.length <= bestIdxs.length) continue;
      const perSide = sig.length / 6;
      const hit = [0, 0, 0, 0, 0, 0];
      for (const p of idxs) hit[Math.floor(p / perSide) % 6]++;
      if (hit.some((v) => v < 2)) continue;
      bestIdxs = idxs;
      bestRx = rx;
      bestRy = ry;
      bestFlat = flat;
      bestN = sig.length;
    }
  }
  if (bestIdxs.length < 12) return [];
  return holesOnHexagon(lum, w, h, cx, cy, bestRx, bestRy, bestFlat, bestIdxs, bestN, scale);
}

function detectRingHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectEllipseFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  const diamond = detectDiamondFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (diamond.length > best.length) best = diamond;
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectEllipseFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectEllipseFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      const wideD = detectDiamondFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tallD = detectDiamondFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
      if (wideD.length > best.length) best = wideD;
      if (tallD.length > best.length) best = tallD;
    }
  }
  return best;
}

function detectHexagonHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectHexagonFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectHexagonFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectHexagonFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
    }
  }
  return best;
}

function detectOctagonHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectOctagonFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectOctagonFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectOctagonFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
    }
  }
  return best;
}

function detectPentagonHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectPentagonFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectPentagonFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectPentagonFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
    }
  }
  return best;
}

function detectTriangleHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectTriangleFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectTriangleFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectTriangleFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
    }
  }
  return best;
}

function detectStarHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectStarFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectStarFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectStarFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
    }
  }
  return best;
}

function detectHeartHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectHeartFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectHeartFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectHeartFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
    }
  }
  return best;
}

function detectCrescentHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectCrescentFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectCrescentFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectCrescentFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
    }
  }
  return best;
}

function detectTeardropHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectTeardropFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectTeardropFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectTeardropFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
    }
  }
  return best;
}

function detectShieldHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectShieldFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectShieldFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectShieldFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
    }
  }
  return best;
}

function detectCrossHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectCrossFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectCrossFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectCrossFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
    }
  }
  return best;
}

function detectArrowHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectArrowFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectArrowFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectArrowFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
    }
  }
  return best;
}

function detectCloudHoles(lum, w, h, scale = 1, rect) {
  const x0 = rect ? Math.max(0, Math.floor(rect.x0)) : 0;
  const y0 = rect ? Math.max(0, Math.floor(rect.y0)) : 0;
  const x1 = rect ? Math.min(w, Math.ceil(rect.x1)) : w;
  const y1 = rect ? Math.min(h, Math.ceil(rect.y1)) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = detectCloudFamily(lum, w, h, cx, cy, rxMax, ryMax, scale);
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const wide = detectCloudFamily(lum, w, h, cx, cy, rxMax, rxMax / a, scale);
      const tall = detectCloudFamily(lum, w, h, cx, cy, ryMax / a, ryMax, scale);
      if (wide.length > best.length) best = wide;
      if (tall.length > best.length) best = tall;
    }
  }
  return best;
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
  if (sidedness(holes, 8) >= 8) return null;
  if ((radii[radii.length - 1] - radii[0]) / r > 0.08) return null;
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

function stampEllipseFromHoles(holes) {
  if (holes.length < 12) return null;
  let sx = 0;
  let sy = 0;
  for (const hole of holes) {
    sx += hole.cx;
    sy += hole.cy;
  }
  const n = holes.length;
  const cx = sx / n;
  const cy = sy / n;
  let sxx = 0;
  let syy = 0;
  for (const hole of holes) {
    sxx += (hole.cx - cx) ** 2;
    syy += (hole.cy - cy) ** 2;
  }
  const rx = Math.sqrt(2 * sxx / n);
  const ry = Math.sqrt(2 * syy / n);
  if (rx < 16 || ry < 16) return null;
  const aspect = rx >= ry ? rx / ry : ry / rx;
  if (aspect < 1.18) return null;
  let inliers = 0;
  for (const hole of holes) {
    const e = ((hole.cx - cx) / rx) ** 2 + ((hole.cy - cy) / ry) ** 2;
    if (e >= 0.82 && e <= 1.2) inliers++;
  }
  if (inliers < 12 || inliers < n * 0.75) return null;
  return { cx, cy, rx: rx + 1.2, ry: ry + 1.2 };
}

function keepHoleEllipse(lum, holes, ell, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const invRx2 = 1 / (ell.rx * ell.rx);
  const invRy2 = 1 / (ell.ry * ell.ry);
  const x0 = Math.max(0, Math.floor(ell.cx - ell.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(ell.cx + ell.rx + 1));
  const y0 = Math.max(0, Math.floor(ell.cy - ell.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(ell.cy + ell.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - ell.cx;
      const dy = y - ell.cy;
      if (dx * dx * invRx2 + dy * dy * invRy2 <= 1) alpha[y * w + x] = 255;
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function stampDiamondFromHoles(holes) {
  if (holes.length < 12) return null;
  let sx = 0;
  let sy = 0;
  for (const hole of holes) {
    sx += hole.cx;
    sy += hole.cy;
  }
  const n = holes.length;
  const cx = sx / n;
  const cy = sy / n;
  let rx = 0;
  let ry = 0;
  for (const hole of holes) {
    const dx = Math.abs(hole.cx - cx);
    const dy = Math.abs(hole.cy - cy);
    if (dx > rx) rx = dx;
    if (dy > ry) ry = dy;
  }
  if (rx < 16 || ry < 16) return null;
  let inliers = 0;
  for (const hole of holes) {
    const e = Math.abs(hole.cx - cx) / rx + Math.abs(hole.cy - cy) / ry;
    if (e >= 0.82 && e <= 1.18) inliers++;
  }
  if (inliers < 12 || inliers < n * 0.75) return null;
  return { cx, cy, rx: rx + 1.2, ry: ry + 1.2 };
}

function keepHoleDiamond(lum, holes, dia, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const x0 = Math.max(0, Math.floor(dia.cx - dia.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(dia.cx + dia.rx + 1));
  const y0 = Math.max(0, Math.floor(dia.cy - dia.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(dia.cy + dia.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.abs(x - dia.cx) / dia.rx + Math.abs(y - dia.cy) / dia.ry <= 1) {
        alpha[y * w + x] = 255;
      }
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function hexNorm(dx, dy, rx, ry, flat) {
  const ax = Math.abs(dx) / rx;
  const ay = Math.abs(dy) / ry;
  return flat ? Math.max(ax, ay, ax + ay * 0.5) : Math.max(ax, ay, ax * 0.5 + ay);
}

function stampHexagonFromHoles(holes) {
  if (holes.length < 12) return null;
  if (sidedness(holes, 8) >= 8) return null;
  let sx = 0;
  let sy = 0;
  for (const hole of holes) {
    sx += hole.cx;
    sy += hole.cy;
  }
  const n = holes.length;
  const cx = sx / n;
  const cy = sy / n;
  let rx = 0;
  let ry = 0;
  for (const hole of holes) {
    const dx = Math.abs(hole.cx - cx);
    const dy = Math.abs(hole.cy - cy);
    if (dx > rx) rx = dx;
    if (dy > ry) ry = dy;
  }
  if (rx < 16 || ry < 16) return null;
  let bestFlat = false;
  let bestIn = 0;
  for (const flat of [false, true]) {
    let inliers = 0;
    const hit = [0, 0, 0, 0, 0, 0];
    for (const hole of holes) {
      const e = hexNorm(hole.cx - cx, hole.cy - cy, rx, ry, flat);
      if (e < 0.82 || e > 1.18) continue;
      inliers++;
      let ang = Math.atan2(hole.cy - cy, hole.cx - cx);
      if (flat) ang += Math.PI / 6;
      const s = Math.floor(((ang + Math.PI * 3) / (Math.PI * 2)) * 6) % 6;
      hit[s] = 1;
    }
    let sides = 0;
    for (const v of hit) sides += v;
    if (sides < 6) continue;
    if (inliers > bestIn) {
      bestIn = inliers;
      bestFlat = flat;
    }
  }
  if (bestIn < 12 || bestIn < n * 0.75) return null;
  return { cx, cy, rx: rx + 1.2, ry: ry + 1.2, flat: bestFlat };
}

function keepHoleHexagon(lum, holes, hex, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const x0 = Math.max(0, Math.floor(hex.cx - hex.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(hex.cx + hex.rx + 1));
  const y0 = Math.max(0, Math.floor(hex.cy - hex.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(hex.cy + hex.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (hexNorm(x - hex.cx, y - hex.cy, hex.rx, hex.ry, hex.flat) <= 1) {
        alpha[y * w + x] = 255;
      }
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function octagonVerts(cx, cy, rx, ry) {
  const k = Math.SQRT2 - 1;
  return [
    [cx + rx, cy - ry * k],
    [cx + rx, cy + ry * k],
    [cx + rx * k, cy + ry],
    [cx - rx * k, cy + ry],
    [cx - rx, cy + ry * k],
    [cx - rx, cy - ry * k],
    [cx - rx * k, cy - ry],
    [cx + rx * k, cy - ry],
  ];
}

function sampleOctagonMin(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = octagonVerts(cx, cy, rx, ry);
  const perSide = Math.max(10, Math.round((rx + ry) * 0.55));
  const sig = new Float32Array(perSide * 8);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  let k = 0;
  for (let s = 0; s < 8; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 8][0];
    const y1 = verts[(s + 1) % 8][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnOctagon(lum, w, h, cx, cy, rx, ry, idxs, n, scale) {
  const perSide = n / 8;
  const verts = octagonVerts(cx, cy, rx, ry);
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 8;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 8][0];
    const y1 = verts[(s + 1) % 8][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    holes.push(refineHole(lum, w, h, x, y, scale));
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectOctagonFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    const sig = sampleOctagonMin(lum, w, h, cx, cy, rx, ry);
    const idxs = closedValleyIndexes(sig);
    if (idxs.length < bestIdxs.length) continue;
    if (idxs.length === bestIdxs.length && rx + ry <= bestRx + bestRy) continue;
    const perSide = sig.length / 8;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of idxs) {
      const u = (p % perSide) / perSide;
      if (u <= 0.2 || u >= 0.8) continue;
      hit[Math.floor(p / perSide) % 8]++;
    }
    if (hit.some((v) => v < 2)) continue;
    bestIdxs = idxs;
    bestRx = rx;
    bestRy = ry;
    bestN = sig.length;
  }
  if (bestIdxs.length < 12) return [];
  const holes = holesOnOctagon(lum, w, h, cx, cy, bestRx, bestRy, bestIdxs, bestN, scale);
  return holesAtBoxCorners(holes) ? [] : holes;
}

function pentagonVerts(cx, cy, rx, ry) {
  const verts = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    verts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return verts;
}

function samplePentagonMin(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = pentagonVerts(cx, cy, rx, ry);
  const perSide = Math.max(12, Math.round((rx + ry) * 0.65));
  const sig = new Float32Array(perSide * 5);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  let k = 0;
  for (let s = 0; s < 5; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 5][0];
    const y1 = verts[(s + 1) % 5][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnPentagon(lum, w, h, cx, cy, rx, ry, idxs, n, scale) {
  const perSide = n / 5;
  const verts = pentagonVerts(cx, cy, rx, ry);
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 5;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 5][0];
    const y1 = verts[(s + 1) % 5][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    holes.push(refineHole(lum, w, h, x, y, scale));
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectPentagonFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    const sig = samplePentagonMin(lum, w, h, cx, cy, rx, ry);
    const idxs = closedValleyIndexes(sig);
    if (idxs.length <= bestIdxs.length) continue;
    const perSide = sig.length / 5;
    const hit = [0, 0, 0, 0, 0];
    for (const p of idxs) hit[Math.floor(p / perSide) % 5]++;
    if (hit.some((v) => v < 2)) continue;
    bestIdxs = idxs;
    bestRx = rx;
    bestRy = ry;
    bestN = sig.length;
  }
  if (bestIdxs.length < 12) return [];
  const holes = holesOnPentagon(lum, w, h, cx, cy, bestRx, bestRy, bestIdxs, bestN, scale);
  return holesAtBoxCorners(holes) ? [] : holes;
}

function holesAtBoxCorners(holes) {
  if (holes.length < 8) return false;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const hole of holes) {
    if (hole.cx < x0) x0 = hole.cx;
    if (hole.cy < y0) y0 = hole.cy;
    if (hole.cx > x1) x1 = hole.cx;
    if (hole.cy > y1) y1 = hole.cy;
  }
  const tol = Math.min(x1 - x0, y1 - y0) * 0.18;
  const t2 = tol * tol;
  const near = (x, y) => holes.some((hole) => (hole.cx - x) ** 2 + (hole.cy - y) ** 2 <= t2);
  return near(x0, y0) && near(x1, y0) && near(x0, y1) && near(x1, y1);
}

function sidedness(holes, sides) {
  if (holes.length < sides * 2) return 0;
  let sx = 0;
  let sy = 0;
  for (const hole of holes) {
    sx += hole.cx;
    sy += hole.cy;
  }
  const cx = sx / holes.length;
  const cy = sy / holes.length;
  let rSum = 0;
  const bins = Array.from({ length: sides }, () => []);
  for (const hole of holes) {
    rSum += Math.hypot(hole.cx - cx, hole.cy - cy);
    const ang = Math.atan2(hole.cy - cy, hole.cx - cx);
    const s = Math.floor(((ang + Math.PI / sides + Math.PI * 3) / (Math.PI * 2)) * sides) % sides;
    bins[s].push(hole);
  }
  const maxRms = Math.max(1.2, (rSum / holes.length) * 0.02);
  let good = 0;
  for (const bin of bins) {
    if (bin.length < 2) continue;
    let mx = 0;
    let my = 0;
    for (const p of bin) {
      mx += p.cx;
      my += p.cy;
    }
    mx /= bin.length;
    my /= bin.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const p of bin) {
      const dx = p.cx - mx;
      const dy = p.cy - my;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const sa = Math.sin(ang);
    const ca = Math.cos(ang);
    let e = 0;
    for (const p of bin) {
      const d = -(p.cx - mx) * sa + (p.cy - my) * ca;
      e += d * d;
    }
    if (Math.sqrt(e / bin.length) <= maxRms) good++;
  }
  return good;
}

function octNorm(dx, dy, rx, ry) {
  const ax = Math.abs(dx) / rx;
  const ay = Math.abs(dy) / ry;
  return Math.max(ax, ay, (ax + ay) / Math.SQRT2);
}

function stampOctagonFromHoles(holes) {
  if (holes.length < 12) return null;
  let sx = 0;
  let sy = 0;
  for (const hole of holes) {
    sx += hole.cx;
    sy += hole.cy;
  }
  const n = holes.length;
  const cx = sx / n;
  const cy = sy / n;
  let rx = 0;
  let ry = 0;
  for (const hole of holes) {
    const dx = Math.abs(hole.cx - cx);
    const dy = Math.abs(hole.cy - cy);
    if (dx > rx) rx = dx;
    if (dy > ry) ry = dy;
  }
  if (rx < 16 || ry < 16) return null;
  if (holesAtBoxCorners(holes) || sidedness(holes, 8) < 8) return null;
  let inliers = 0;
  const hit = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const hole of holes) {
    const e = octNorm(hole.cx - cx, hole.cy - cy, rx, ry);
    if (e < 0.82 || e > 1.18) continue;
    inliers++;
    const ang = Math.atan2(hole.cy - cy, hole.cx - cx);
    const s = Math.floor(((ang + Math.PI / 8 + Math.PI * 3) / (Math.PI * 2)) * 8) % 8;
    hit[s]++;
  }
  if (hit.some((v) => v < 2)) return null;
  if (inliers < 12 || inliers < n * 0.75) return null;
  return { cx, cy, rx: rx + 1.2, ry: ry + 1.2 };
}

function keepHoleOctagon(lum, holes, oct, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const x0 = Math.max(0, Math.floor(oct.cx - oct.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(oct.cx + oct.rx + 1));
  const y0 = Math.max(0, Math.floor(oct.cy - oct.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(oct.cy + oct.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (octNorm(x - oct.cx, y - oct.cy, oct.rx, oct.ry) <= 1) {
        alpha[y * w + x] = 255;
      }
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function pentNorm(dx, dy, rx, ry) {
  const x = dx / rx;
  const y = dy / ry;
  let m = -Infinity;
  for (let i = 0; i < 5; i++) {
    const a0 = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const a1 = -Math.PI / 2 + (((i + 1) % 5) * Math.PI * 2) / 5;
    const vx = Math.cos(a0);
    const vy = Math.sin(a0);
    const wx = Math.cos(a1);
    const wy = Math.sin(a1);
    let onx = wy - vy;
    let ony = vx - wx;
    const mx = (vx + wx) / 2;
    const my = (vy + wy) / 2;
    if (onx * mx + ony * my < 0) {
      onx = -onx;
      ony = -ony;
    }
    const len = Math.hypot(onx, ony) || 1;
    onx /= len;
    ony /= len;
    const d = mx * onx + my * ony;
    const e = (x * onx + y * ony) / (d || 1e-9);
    if (e > m) m = e;
  }
  return m;
}

function stampPentagonFromHoles(holes) {
  if (holes.length < 12) return null;
  if (holesAtBoxCorners(holes) || sidedness(holes, 8) >= 8) return null;
  let sx = 0;
  let sy = 0;
  for (const hole of holes) {
    sx += hole.cx;
    sy += hole.cy;
  }
  const n = holes.length;
  const cx = sx / n;
  const cy = sy / n;
  let rx = 0;
  let ry = 0;
  for (const hole of holes) {
    const dx = Math.abs(hole.cx - cx);
    const dy = Math.abs(hole.cy - cy);
    if (dx > rx) rx = dx;
    if (dy > ry) ry = dy;
  }
  if (rx < 16 || ry < 16) return null;
  rx /= Math.cos(Math.PI / 10);
  let inliers = 0;
  const hit = [0, 0, 0, 0, 0];
  for (const hole of holes) {
    const e = pentNorm(hole.cx - cx, hole.cy - cy, rx, ry);
    if (e < 0.82 || e > 1.18) continue;
    inliers++;
    const ang = Math.atan2(hole.cy - cy, hole.cx - cx);
    const s = Math.floor(((ang + Math.PI / 5 + Math.PI * 3) / (Math.PI * 2)) * 5) % 5;
    hit[s]++;
  }
  if (hit.some((v) => v < 2)) return null;
  if (inliers < 12 || inliers < n * 0.75) return null;
  return { cx, cy, rx: rx + 1.2, ry: ry + 1.2 };
}

function keepHolePentagon(lum, holes, pent, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const x0 = Math.max(0, Math.floor(pent.cx - pent.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(pent.cx + pent.rx + 1));
  const y0 = Math.max(0, Math.floor(pent.cy - pent.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(pent.cy + pent.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pentNorm(x - pent.cx, y - pent.cy, pent.rx, pent.ry) <= 1) {
        alpha[y * w + x] = 255;
      }
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function triangleVerts(cx, cy, rx, ry, flip) {
  return flip
    ? [[cx, cy + ry], [cx + rx, cy - ry], [cx - rx, cy - ry]]
    : [[cx, cy - ry], [cx - rx, cy + ry], [cx + rx, cy + ry]];
}

function sampleTriangleMin(lum, w, h, cx, cy, rx, ry, flip) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = triangleVerts(cx, cy, rx, ry, flip);
  const perSide = Math.max(20, Math.round((rx + ry) * 0.85));
  const sig = new Float32Array(perSide * 3);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  let k = 0;
  for (let s = 0; s < 3; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 3][0];
    const y1 = verts[(s + 1) % 3][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnTriangle(lum, w, h, cx, cy, rx, ry, flip, idxs, n, scale) {
  const perSide = n / 3;
  const verts = triangleVerts(cx, cy, rx, ry, flip);
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 3;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 3][0];
    const y1 = verts[(s + 1) % 3][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const hole = refineHole(lum, w, h, x, y, scale);
    hole.r = Math.min(hole.r, 3.4 * scale);
    holes.push(hole);
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectTriangleFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestFlip = false;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    for (const flip of [false, true]) {
      const sig = sampleTriangleMin(lum, w, h, cx, cy, rx, ry, flip);
      const idxs = closedValleyIndexes(sig);
      if (idxs.length < bestIdxs.length) continue;
      if (idxs.length === bestIdxs.length && rx + ry <= bestRx + bestRy) continue;
      const perSide = sig.length / 3;
      const hit = [0, 0, 0];
      for (const p of idxs) hit[Math.floor(p / perSide) % 3]++;
      if (hit.some((v) => v < 4)) continue;
      bestIdxs = idxs;
      bestRx = rx;
      bestRy = ry;
      bestFlip = flip;
      bestN = sig.length;
    }
  }
  if (bestIdxs.length < 12) return [];
  const holes = holesOnTriangle(lum, w, h, cx, cy, bestRx, bestRy, bestFlip, bestIdxs, bestN, scale);
  return holesAtBoxCorners(holes) ? [] : holes;
}

function triangleEdge(dx, dy, rx, ry, flip) {
  const x = dx / rx;
  const y = dy / ry;
  const verts = flip ? [[0, 1], [1, -1], [-1, -1]] : [[0, -1], [-1, 1], [1, 1]];
  let best = 0;
  let m = -Infinity;
  for (let i = 0; i < 3; i++) {
    const vx = verts[i][0];
    const vy = verts[i][1];
    const wx = verts[(i + 1) % 3][0];
    const wy = verts[(i + 1) % 3][1];
    let onx = wy - vy;
    let ony = vx - wx;
    const mx = (vx + wx) / 2;
    const my = (vy + wy) / 2;
    if (onx * mx + ony * my < 0) {
      onx = -onx;
      ony = -ony;
    }
    const len = Math.hypot(onx, ony) || 1;
    onx /= len;
    ony /= len;
    const d = mx * onx + my * ony;
    const e = (x * onx + y * ony) / (d || 1e-9);
    if (e > m) {
      m = e;
      best = i;
    }
  }
  return { e: m, side: best };
}

function triangleNorm(dx, dy, rx, ry, flip) {
  return triangleEdge(dx, dy, rx, ry, flip).e;
}

function stampTriangleFromHoles(holes) {
  if (holes.length < 12) return null;
  if (holesAtBoxCorners(holes) || sidedness(holes, 8) >= 8) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const hole of holes) {
    if (hole.cx < x0) x0 = hole.cx;
    if (hole.cy < y0) y0 = hole.cy;
    if (hole.cx > x1) x1 = hole.cx;
    if (hole.cy > y1) y1 = hole.cy;
  }
  const n = holes.length;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  if (rx < 16 || ry < 16) return null;
  let bestFlip = false;
  let bestIn = 0;
  for (const flip of [false, true]) {
    let inliers = 0;
    const hit = [0, 0, 0];
    for (const hole of holes) {
      const edge = triangleEdge(hole.cx - cx, hole.cy - cy, rx, ry, flip);
      if (edge.e < 0.82 || edge.e > 1.18) continue;
      inliers++;
      hit[edge.side]++;
    }
    if (hit.some((v) => v < 4)) continue;
    if (inliers > bestIn) {
      bestIn = inliers;
      bestFlip = flip;
    }
  }
  if (bestIn < 12 || bestIn < n * 0.75) return null;
  return { cx, cy, rx: rx * 1.08 + 1.2, ry: ry * 1.08 + 1.2, flip: bestFlip };
}

function keepHoleTriangle(lum, holes, tri, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const x0 = Math.max(0, Math.floor(tri.cx - tri.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(tri.cx + tri.rx + 1));
  const y0 = Math.max(0, Math.floor(tri.cy - tri.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(tri.cy + tri.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (triangleNorm(x - tri.cx, y - tri.cy, tri.rx, tri.ry, tri.flip) <= 1) {
        alpha[y * w + x] = 255;
      }
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function starVerts(cx, cy, rx, ry, inner) {
  const verts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const t = i % 2 === 0 ? 1 : inner;
    verts.push([cx + rx * t * Math.cos(a), cy + ry * t * Math.sin(a)]);
  }
  return verts;
}

function sampleStarMin(lum, w, h, cx, cy, rx, ry, inner) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = starVerts(cx, cy, rx, ry, inner);
  const perSide = Math.max(8, Math.round((rx + ry) * 0.35));
  const sig = new Float32Array(perSide * 10);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  let k = 0;
  for (let s = 0; s < 10; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 10][0];
    const y1 = verts[(s + 1) % 10][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnStar(lum, w, h, cx, cy, rx, ry, inner, idxs, n, scale) {
  const perSide = n / 10;
  const verts = starVerts(cx, cy, rx, ry, inner);
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 10;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 10][0];
    const y1 = verts[(s + 1) % 10][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const hole = refineHole(lum, w, h, x, y, scale);
    hole.r = Math.min(hole.r, 3.4 * scale);
    holes.push(hole);
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectStarFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestInner = 0.43;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    for (const inner of [0.36, 0.4, 0.43, 0.48]) {
      const sig = sampleStarMin(lum, w, h, cx, cy, rx, ry, inner);
      const idxs = closedValleyIndexes(sig);
      if (idxs.length < bestIdxs.length) continue;
      if (idxs.length === bestIdxs.length && rx + ry <= bestRx + bestRy) continue;
      const perSide = sig.length / 10;
      const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (const p of idxs) hit[Math.floor(p / perSide) % 10]++;
      if (hit.filter((v) => v >= 1).length < 8) continue;
      bestIdxs = idxs;
      bestRx = rx;
      bestRy = ry;
      bestInner = inner;
      bestN = sig.length;
    }
  }
  if (bestIdxs.length < 12) return [];
  const holes = holesOnStar(lum, w, h, cx, cy, bestRx, bestRy, bestInner, bestIdxs, bestN, scale);
  return holesAtBoxCorners(holes) ? [] : holes;
}

function distToSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
}

function pointInStar(x, y, verts) {
  let inside = false;
  for (let i = 0, j = 9; i < 10; j = i++) {
    const xi = verts[i][0];
    const yi = verts[i][1];
    const xj = verts[j][0];
    const yj = verts[j][1];
    const hit = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

function stampStarFromHoles(holes) {
  if (holes.length < 12) return null;
  if (holesAtBoxCorners(holes) || sidedness(holes, 8) >= 8) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const hole of holes) {
    if (hole.cx < x0) x0 = hole.cx;
    if (hole.cy < y0) y0 = hole.cy;
    if (hole.cx > x1) x1 = hole.cx;
    if (hole.cy > y1) y1 = hole.cy;
  }
  const n = holes.length;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  if (rx < 16 || ry < 16) return null;
  let bestInner = 0;
  let bestIn = 0;
  const tol = Math.min(rx, ry) * 0.14;
  for (const inner of [0.36, 0.4, 0.43, 0.48]) {
    const verts = starVerts(cx, cy, rx, ry, inner);
    let inliers = 0;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const hole of holes) {
      let bestD = Infinity;
      let bestS = 0;
      for (let s = 0; s < 10; s++) {
        const d = distToSeg(hole.cx, hole.cy, verts[s][0], verts[s][1], verts[(s + 1) % 10][0], verts[(s + 1) % 10][1]);
        if (d < bestD) {
          bestD = d;
          bestS = s;
        }
      }
      if (bestD > tol) continue;
      inliers++;
      hit[bestS]++;
    }
    if (hit.filter((v) => v >= 1).length < 8) continue;
    if (inliers > bestIn) {
      bestIn = inliers;
      bestInner = inner;
    }
  }
  if (bestIn < 12 || bestIn < n * 0.7) return null;
  return { cx, cy, rx: rx * 1.08 + 1.2, ry: ry * 1.08 + 1.2, inner: bestInner };
}

function keepHoleStar(lum, holes, star, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const verts = starVerts(star.cx, star.cy, star.rx, star.ry, star.inner);
  const x0 = Math.max(0, Math.floor(star.cx - star.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(star.cx + star.rx + 1));
  const y0 = Math.max(0, Math.floor(star.cy - star.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(star.cy + star.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pointInStar(x, y, verts)) alpha[y * w + x] = 255;
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function heartVerts(cx, cy, rx, ry) {
  const dense = [];
  const n = 256;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    dense.push([
      16 * Math.sin(t) ** 3,
      -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
    ]);
  }
  const acc = [0];
  for (let i = 1; i < dense.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  const total = acc[acc.length - 1] || 1;
  const raw = [];
  for (let s = 0; s < 16; s++) {
    const target = (s / 16) * total;
    let k = 1;
    while (k < acc.length && acc[k] < target) k++;
    const u = (target - acc[k - 1]) / Math.max(1e-9, acc[k] - acc[k - 1]);
    raw.push([
      dense[k - 1][0] + (dense[k][0] - dense[k - 1][0]) * u,
      dense[k - 1][1] + (dense[k][1] - dense[k - 1][1]) * u,
    ]);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of raw) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const ocx = (x0 + x1) / 2;
  const ocy = (y0 + y1) / 2;
  const orx = (x1 - x0) / 2 || 1;
  const ory = (y1 - y0) / 2 || 1;
  return raw.map(([x, y]) => [cx + ((x - ocx) / orx) * rx, cy + ((y - ocy) / ory) * ry]);
}

function sampleHeartMin(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = heartVerts(cx, cy, rx, ry);
  const perSide = Math.max(8, Math.round((rx + ry) * 0.28));
  const sig = new Float32Array(perSide * 16);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  let k = 0;
  for (let s = 0; s < 16; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnHeart(lum, w, h, cx, cy, rx, ry, idxs, n, scale) {
  const perSide = n / 16;
  const verts = heartVerts(cx, cy, rx, ry);
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 16;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const hole = refineHole(lum, w, h, x, y, scale);
    hole.r = Math.min(hole.r, 3.4 * scale);
    holes.push(hole);
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectHeartFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    const sig = sampleHeartMin(lum, w, h, cx, cy, rx, ry);
    const idxs = closedValleyIndexes(sig);
    if (idxs.length < bestIdxs.length) continue;
    if (idxs.length === bestIdxs.length && rx + ry <= bestRx + bestRy) continue;
    const perSide = sig.length / 16;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of idxs) hit[Math.floor(p / perSide) % 16]++;
    if (hit.filter((v) => v >= 1).length < 10) continue;
    bestIdxs = idxs;
    bestRx = rx;
    bestRy = ry;
    bestN = sig.length;
  }
  if (bestIdxs.length < 12) return [];
  const holes = holesOnHeart(lum, w, h, cx, cy, bestRx, bestRy, bestIdxs, bestN, scale);
  return holesAtBoxCorners(holes) ? [] : holes;
}

function pointInHeart(x, y, verts) {
  let inside = false;
  for (let i = 0, j = 15; i < 16; j = i++) {
    const xi = verts[i][0];
    const yi = verts[i][1];
    const xj = verts[j][0];
    const yj = verts[j][1];
    const hit = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

function stampHeartFromHoles(holes) {
  if (holes.length < 12) return null;
  if (holesAtBoxCorners(holes) || sidedness(holes, 8) >= 8) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const hole of holes) {
    if (hole.cx < x0) x0 = hole.cx;
    if (hole.cy < y0) y0 = hole.cy;
    if (hole.cx > x1) x1 = hole.cx;
    if (hole.cy > y1) y1 = hole.cy;
  }
  const n = holes.length;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  if (rx < 16 || ry < 16) return null;
  const verts = heartVerts(cx, cy, rx, ry);
  const tol = Math.min(rx, ry) * 0.14;
  const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let inliers = 0;
  for (const hole of holes) {
    let bestD = Infinity;
    let bestS = 0;
    for (let s = 0; s < 16; s++) {
      const d = distToSeg(hole.cx, hole.cy, verts[s][0], verts[s][1], verts[(s + 1) % 16][0], verts[(s + 1) % 16][1]);
      if (d < bestD) {
        bestD = d;
        bestS = s;
      }
    }
    if (bestD > tol) continue;
    inliers++;
    hit[bestS]++;
  }
  if (hit.filter((v) => v >= 1).length < 10) return null;
  if (inliers < 12 || inliers < n * 0.7) return null;
  return { cx, cy, rx: rx * 1.08 + 1.2, ry: ry * 1.08 + 1.2 };
}

function keepHoleHeart(lum, holes, heart, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const verts = heartVerts(heart.cx, heart.cy, heart.rx, heart.ry);
  const x0 = Math.max(0, Math.floor(heart.cx - heart.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(heart.cx + heart.rx + 1));
  const y0 = Math.max(0, Math.floor(heart.cy - heart.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(heart.cy + heart.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pointInHeart(x, y, verts)) alpha[y * w + x] = 255;
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function rotCrescent(x, y, dir) {
  if (dir === 1) return [-x, y];
  if (dir === 2) return [y, -x];
  if (dir === 3) return [-y, x];
  return [x, y];
}

function unrotCrescent(x, y, dir) {
  if (dir === 1) return [-x, y];
  if (dir === 2) return [-y, x];
  if (dir === 3) return [y, -x];
  return [x, y];
}

function crescentRaw(inner, shift) {
  const n = 256;
  const outerAng = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a);
    const y = Math.sin(a);
    if (((x - shift) / inner) ** 2 + (y / inner) ** 2 >= 0.999) outerAng.push(a);
  }
  let start = 0;
  let bestGap = 0;
  for (let i = 0; i < outerAng.length; i++) {
    const next = outerAng[(i + 1) % outerAng.length] + (i + 1 >= outerAng.length ? Math.PI * 2 : 0);
    const gap = next - outerAng[i];
    if (gap > bestGap) {
      bestGap = gap;
      start = (i + 1) % outerAng.length;
    }
  }
  const outer = [];
  for (let k = 0; k < outerAng.length; k++) {
    const a = outerAng[(start + k) % outerAng.length];
    outer.push([Math.cos(a), Math.sin(a)]);
  }
  const innerAng = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = shift + inner * Math.cos(a);
    const y = inner * Math.sin(a);
    if (x * x + y * y <= 1.001) innerAng.push(a);
  }
  let iStart = 0;
  let iGap = 0;
  for (let i = 0; i < innerAng.length; i++) {
    const next = innerAng[(i + 1) % innerAng.length] + (i + 1 >= innerAng.length ? Math.PI * 2 : 0);
    const gap = next - innerAng[i];
    if (gap > iGap) {
      iGap = gap;
      iStart = (i + 1) % innerAng.length;
    }
  }
  const inn = [];
  for (let k = 0; k < innerAng.length; k++) {
    const a = innerAng[(iStart + k) % innerAng.length];
    inn.push([shift + inner * Math.cos(a), inner * Math.sin(a)]);
  }
  if (!outer.length || !inn.length) return [];
  const last = outer[outer.length - 1];
  const d0 = Math.hypot(inn[0][0] - last[0], inn[0][1] - last[1]);
  const d1 = Math.hypot(inn[inn.length - 1][0] - last[0], inn[inn.length - 1][1] - last[1]);
  if (d1 < d0) inn.reverse();
  return outer.concat(inn);
}

function crescentVerts(cx, cy, rx, ry, inner = 0.72, shift = 0.4, dir = 0) {
  const dense = crescentRaw(inner, shift);
  if (dense.length < 8) return [];
  const acc = [0];
  for (let i = 1; i < dense.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  const total = acc[acc.length - 1] || 1;
  const raw = [];
  for (let s = 0; s < 16; s++) {
    const target = (s / 16) * total;
    let k = 1;
    while (k < acc.length && acc[k] < target) k++;
    const u = (target - acc[k - 1]) / Math.max(1e-9, acc[k] - acc[k - 1]);
    raw.push([
      dense[k - 1][0] + (dense[k][0] - dense[k - 1][0]) * u,
      dense[k - 1][1] + (dense[k][1] - dense[k - 1][1]) * u,
    ]);
  }
  return raw.map(([x, y]) => {
    const [xx, yy] = rotCrescent(x, y, dir);
    return [cx + xx * rx, cy + yy * ry];
  });
}

function inCrescent(x, y, cx, cy, rx, ry, inner = 0.72, shift = 0.4, dir = 0) {
  const [ux, uy] = unrotCrescent((x - cx) / rx, (y - cy) / ry, dir);
  if (ux * ux + uy * uy > 1) return false;
  const ix = (ux - shift) / inner;
  const iy = uy / inner;
  return ix * ix + iy * iy >= 1;
}

function sampleCrescentMin(lum, w, h, cx, cy, rx, ry, inner, shift, dir) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = crescentVerts(cx, cy, rx, ry, inner, shift, dir);
  if (verts.length < 16) return new Float32Array(0);
  const perSide = Math.max(8, Math.round((rx + ry) * 0.28));
  const sig = new Float32Array(perSide * 16);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  let k = 0;
  for (let s = 0; s < 16; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnCrescent(lum, w, h, cx, cy, rx, ry, inner, shift, dir, idxs, n, scale) {
  const perSide = n / 16;
  const verts = crescentVerts(cx, cy, rx, ry, inner, shift, dir);
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 16;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const hole = refineHole(lum, w, h, x, y, scale);
    hole.r = Math.min(hole.r, 3.4 * scale);
    holes.push(hole);
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectCrescentFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestInner = 0.72;
  let bestShift = 0.4;
  let bestDir = 0;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    for (const dir of [0, 1, 2, 3]) {
      for (const [inner, shift] of [[0.72, 0.4], [0.78, 0.36]]) {
        const sig = sampleCrescentMin(lum, w, h, cx, cy, rx, ry, inner, shift, dir);
        const idxs = closedValleyIndexes(sig);
        if (idxs.length < bestIdxs.length) continue;
        if (idxs.length === bestIdxs.length && rx + ry <= bestRx + bestRy) continue;
        const perSide = sig.length / 16;
        const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (const p of idxs) hit[Math.floor(p / perSide) % 16]++;
        if (hit.filter((v) => v >= 1).length < 10) continue;
        bestIdxs = idxs;
        bestRx = rx;
        bestRy = ry;
        bestInner = inner;
        bestShift = shift;
        bestDir = dir;
        bestN = sig.length;
      }
    }
  }
  if (bestIdxs.length < 12) return [];
  const holes = holesOnCrescent(lum, w, h, cx, cy, bestRx, bestRy, bestInner, bestShift, bestDir, bestIdxs, bestN, scale);
  return holesAtBoxCorners(holes) ? [] : holes;
}

function stampCrescentFromHoles(holes) {
  if (holes.length < 12) return null;
  if (holesAtBoxCorners(holes) || sidedness(holes, 8) >= 8) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const hole of holes) {
    if (hole.cx < x0) x0 = hole.cx;
    if (hole.cy < y0) y0 = hole.cy;
    if (hole.cx > x1) x1 = hole.cx;
    if (hole.cy > y1) y1 = hole.cy;
  }
  const n = holes.length;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  if (rx < 16 || ry < 16) return null;
  const tol = Math.min(rx, ry) * 0.14;
  let best = null;
  let bestIn = 0;
  for (const dir of [0, 1, 2, 3]) {
    for (const [inner, shift] of [[0.72, 0.4], [0.78, 0.36]]) {
      const verts = crescentVerts(cx, cy, rx, ry, inner, shift, dir);
      if (verts.length < 16) continue;
      const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      let inliers = 0;
      for (const hole of holes) {
        let bestD = Infinity;
        let bestS = 0;
        for (let s = 0; s < 16; s++) {
          const d = distToSeg(hole.cx, hole.cy, verts[s][0], verts[s][1], verts[(s + 1) % 16][0], verts[(s + 1) % 16][1]);
          if (d < bestD) {
            bestD = d;
            bestS = s;
          }
        }
        if (bestD > tol) continue;
        inliers++;
        hit[bestS]++;
      }
      if (hit.filter((v) => v >= 1).length < 10) continue;
      if (inliers < 12 || inliers < n * 0.7) continue;
      if (inliers > bestIn) {
        bestIn = inliers;
        best = { cx, cy, rx: rx * 1.08 + 1.2, ry: ry * 1.08 + 1.2, inner, shift, dir };
      }
    }
  }
  return best;
}

function keepHoleCrescent(lum, holes, cres, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const x0 = Math.max(0, Math.floor(cres.cx - cres.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(cres.cx + cres.rx + 1));
  const y0 = Math.max(0, Math.floor(cres.cy - cres.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(cres.cy + cres.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (inCrescent(x, y, cres.cx, cres.cy, cres.rx, cres.ry, cres.inner, cres.shift, cres.dir)) {
        alpha[y * w + x] = 255;
      }
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function teardropRaw() {
  const ccy = 0.32;
  const cr = 0.68;
  const tipY = -1;
  const d = ccy - tipY;
  const phi = Math.acos(Math.min(0.999, cr / d));
  const aL = Math.atan2(-Math.cos(phi), Math.sin(phi));
  const sweep = Math.PI * 2 - 2 * phi;
  const dense = [];
  const nArc = 220;
  for (let i = 0; i <= nArc; i++) {
    const a = aL + (i / nArc) * sweep;
    dense.push([cr * Math.cos(a), ccy + cr * Math.sin(a)]);
  }
  dense.push([0, tipY]);
  dense.push(dense[0]);
  return dense;
}

function teardropVerts(cx, cy, rx, ry) {
  const dense = teardropRaw();
  const acc = [0];
  for (let i = 1; i < dense.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  const total = acc[acc.length - 1] || 1;
  const raw = [];
  for (let s = 0; s < 16; s++) {
    const target = (s / 16) * total;
    let k = 1;
    while (k < acc.length && acc[k] < target) k++;
    const u = (target - acc[k - 1]) / Math.max(1e-9, acc[k] - acc[k - 1]);
    raw.push([
      dense[k - 1][0] + (dense[k][0] - dense[k - 1][0]) * u,
      dense[k - 1][1] + (dense[k][1] - dense[k - 1][1]) * u,
    ]);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of raw) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const ocx = (x0 + x1) / 2;
  const ocy = (y0 + y1) / 2;
  const orx = (x1 - x0) / 2 || 1;
  const ory = (y1 - y0) / 2 || 1;
  return raw.map(([x, y]) => [cx + ((x - ocx) / orx) * rx, cy + ((y - ocy) / ory) * ry]);
}

function sampleTeardropMin(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = teardropVerts(cx, cy, rx, ry);
  const perSide = Math.max(8, Math.round((rx + ry) * 0.28));
  const sig = new Float32Array(perSide * 16);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  let k = 0;
  for (let s = 0; s < 16; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnTeardrop(lum, w, h, cx, cy, rx, ry, idxs, n, scale) {
  const perSide = n / 16;
  const verts = teardropVerts(cx, cy, rx, ry);
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 16;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const hole = refineHole(lum, w, h, x, y, scale);
    hole.r = Math.min(hole.r, 3.4 * scale);
    holes.push(hole);
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectTeardropFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    const sig = sampleTeardropMin(lum, w, h, cx, cy, rx, ry);
    const idxs = closedValleyIndexes(sig);
    if (idxs.length < bestIdxs.length) continue;
    if (idxs.length === bestIdxs.length && rx + ry <= bestRx + bestRy) continue;
    const perSide = sig.length / 16;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of idxs) hit[Math.floor(p / perSide) % 16]++;
    if (hit.filter((v) => v >= 1).length < 10) continue;
    bestIdxs = idxs;
    bestRx = rx;
    bestRy = ry;
    bestN = sig.length;
  }
  if (bestIdxs.length < 12) return [];
  const holes = holesOnTeardrop(lum, w, h, cx, cy, bestRx, bestRy, bestIdxs, bestN, scale);
  return holesAtBoxCorners(holes) ? [] : holes;
}

function pointInTeardrop(x, y, verts) {
  let inside = false;
  for (let i = 0, j = 15; i < 16; j = i++) {
    const xi = verts[i][0];
    const yi = verts[i][1];
    const xj = verts[j][0];
    const yj = verts[j][1];
    const hit = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

function stampTeardropFromHoles(holes) {
  if (holes.length < 12) return null;
  if (holesAtBoxCorners(holes) || sidedness(holes, 8) >= 8) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const hole of holes) {
    if (hole.cx < x0) x0 = hole.cx;
    if (hole.cy < y0) y0 = hole.cy;
    if (hole.cx > x1) x1 = hole.cx;
    if (hole.cy > y1) y1 = hole.cy;
  }
  const n = holes.length;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  if (rx < 16 || ry < 16) return null;
  const verts = teardropVerts(cx, cy, rx, ry);
  const tol = Math.min(rx, ry) * 0.14;
  const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let inliers = 0;
  for (const hole of holes) {
    let bestD = Infinity;
    let bestS = 0;
    for (let s = 0; s < 16; s++) {
      const d = distToSeg(hole.cx, hole.cy, verts[s][0], verts[s][1], verts[(s + 1) % 16][0], verts[(s + 1) % 16][1]);
      if (d < bestD) {
        bestD = d;
        bestS = s;
      }
    }
    if (bestD > tol) continue;
    inliers++;
    hit[bestS]++;
  }
  if (hit.filter((v) => v >= 1).length < 10) return null;
  if (inliers < 12 || inliers < n * 0.7) return null;
  return { cx, cy, rx: rx * 1.08 + 1.2, ry: ry * 1.08 + 1.2 };
}

function keepHoleTeardrop(lum, holes, drop, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const verts = teardropVerts(drop.cx, drop.cy, drop.rx, drop.ry);
  const x0 = Math.max(0, Math.floor(drop.cx - drop.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(drop.cx + drop.rx + 1));
  const y0 = Math.max(0, Math.floor(drop.cy - drop.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(drop.cy + drop.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pointInTeardrop(x, y, verts)) alpha[y * w + x] = 255;
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function shieldRaw() {
  const corners = [
    [-0.85, -1],
    [0.85, -1],
    [0.85, -0.12],
    [0, 1],
    [-0.85, -0.12],
    [-0.85, -1],
  ];
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      dense.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function shieldVerts(cx, cy, rx, ry) {
  const dense = shieldRaw();
  const acc = [0];
  for (let i = 1; i < dense.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  const total = acc[acc.length - 1] || 1;
  const raw = [];
  for (let s = 0; s < 16; s++) {
    const target = (s / 16) * total;
    let k = 1;
    while (k < acc.length && acc[k] < target) k++;
    const u = (target - acc[k - 1]) / Math.max(1e-9, acc[k] - acc[k - 1]);
    raw.push([
      dense[k - 1][0] + (dense[k][0] - dense[k - 1][0]) * u,
      dense[k - 1][1] + (dense[k][1] - dense[k - 1][1]) * u,
    ]);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of raw) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const ocx = (x0 + x1) / 2;
  const ocy = (y0 + y1) / 2;
  const orx = (x1 - x0) / 2 || 1;
  const ory = (y1 - y0) / 2 || 1;
  return raw.map(([x, y]) => [cx + ((x - ocx) / orx) * rx, cy + ((y - ocy) / ory) * ry]);
}

function sampleShieldMin(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = shieldVerts(cx, cy, rx, ry);
  const perSide = Math.max(8, Math.round((rx + ry) * 0.28));
  const sig = new Float32Array(perSide * 16);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  let k = 0;
  for (let s = 0; s < 16; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnShield(lum, w, h, cx, cy, rx, ry, idxs, n, scale) {
  const perSide = n / 16;
  const verts = shieldVerts(cx, cy, rx, ry);
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 16;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const hole = refineHole(lum, w, h, x, y, scale);
    hole.r = Math.min(hole.r, 3.4 * scale);
    holes.push(hole);
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectShieldFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    const sig = sampleShieldMin(lum, w, h, cx, cy, rx, ry);
    const idxs = closedValleyIndexes(sig);
    if (idxs.length < bestIdxs.length) continue;
    if (idxs.length === bestIdxs.length && rx + ry <= bestRx + bestRy) continue;
    const perSide = sig.length / 16;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of idxs) hit[Math.floor(p / perSide) % 16]++;
    if (hit.filter((v) => v >= 1).length < 10) continue;
    bestIdxs = idxs;
    bestRx = rx;
    bestRy = ry;
    bestN = sig.length;
  }
  if (bestIdxs.length < 12) return [];
  const holes = holesOnShield(lum, w, h, cx, cy, bestRx, bestRy, bestIdxs, bestN, scale);
  return holesAtBoxCorners(holes) ? [] : holes;
}

function pointInShield(x, y, verts) {
  let inside = false;
  for (let i = 0, j = 15; i < 16; j = i++) {
    const xi = verts[i][0];
    const yi = verts[i][1];
    const xj = verts[j][0];
    const yj = verts[j][1];
    const hit = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

function stampShieldFromHoles(holes) {
  if (holes.length < 12) return null;
  if (holesAtBoxCorners(holes) || sidedness(holes, 8) >= 8) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const hole of holes) {
    if (hole.cx < x0) x0 = hole.cx;
    if (hole.cy < y0) y0 = hole.cy;
    if (hole.cx > x1) x1 = hole.cx;
    if (hole.cy > y1) y1 = hole.cy;
  }
  const n = holes.length;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  if (rx < 16 || ry < 16) return null;
  const verts = shieldVerts(cx, cy, rx, ry);
  const tol = Math.min(rx, ry) * 0.14;
  const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let inliers = 0;
  for (const hole of holes) {
    let bestD = Infinity;
    let bestS = 0;
    for (let s = 0; s < 16; s++) {
      const d = distToSeg(hole.cx, hole.cy, verts[s][0], verts[s][1], verts[(s + 1) % 16][0], verts[(s + 1) % 16][1]);
      if (d < bestD) {
        bestD = d;
        bestS = s;
      }
    }
    if (bestD > tol) continue;
    inliers++;
    hit[bestS]++;
  }
  if (hit.filter((v) => v >= 1).length < 10) return null;
  if (inliers < 12 || inliers < n * 0.7) return null;
  return { cx, cy, rx: rx * 1.08 + 1.2, ry: ry * 1.08 + 1.2 };
}

function keepHoleShield(lum, holes, shield, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const verts = shieldVerts(shield.cx, shield.cy, shield.rx, shield.ry);
  const x0 = Math.max(0, Math.floor(shield.cx - shield.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(shield.cx + shield.rx + 1));
  const y0 = Math.max(0, Math.floor(shield.cy - shield.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(shield.cy + shield.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pointInShield(x, y, verts)) alpha[y * w + x] = 255;
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function crossRaw() {
  const corners = [
    [-0.35, -1],
    [0.35, -1],
    [0.35, -0.35],
    [1, -0.35],
    [1, 0.35],
    [0.35, 0.35],
    [0.35, 1],
    [-0.35, 1],
    [-0.35, 0.35],
    [-1, 0.35],
    [-1, -0.35],
    [-0.35, -0.35],
    [-0.35, -1],
  ];
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      dense.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function crossVerts(cx, cy, rx, ry) {
  const dense = crossRaw();
  const acc = [0];
  for (let i = 1; i < dense.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  const total = acc[acc.length - 1] || 1;
  const raw = [];
  for (let s = 0; s < 16; s++) {
    const target = (s / 16) * total;
    let k = 1;
    while (k < acc.length && acc[k] < target) k++;
    const u = (target - acc[k - 1]) / Math.max(1e-9, acc[k] - acc[k - 1]);
    raw.push([
      dense[k - 1][0] + (dense[k][0] - dense[k - 1][0]) * u,
      dense[k - 1][1] + (dense[k][1] - dense[k - 1][1]) * u,
    ]);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of raw) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const ocx = (x0 + x1) / 2;
  const ocy = (y0 + y1) / 2;
  const orx = (x1 - x0) / 2 || 1;
  const ory = (y1 - y0) / 2 || 1;
  return raw.map(([x, y]) => [cx + ((x - ocx) / orx) * rx, cy + ((y - ocy) / ory) * ry]);
}

function sampleCrossMin(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = crossVerts(cx, cy, rx, ry);
  const perSide = Math.max(8, Math.round((rx + ry) * 0.28));
  const sig = new Float32Array(perSide * 16);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  let k = 0;
  for (let s = 0; s < 16; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnCross(lum, w, h, cx, cy, rx, ry, idxs, n, scale) {
  const perSide = n / 16;
  const verts = crossVerts(cx, cy, rx, ry);
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 16;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const hole = refineHole(lum, w, h, x, y, scale);
    hole.r = Math.min(hole.r, 3.4 * scale);
    holes.push(hole);
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectCrossFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    const sig = sampleCrossMin(lum, w, h, cx, cy, rx, ry);
    const idxs = closedValleyIndexes(sig);
    if (idxs.length < bestIdxs.length) continue;
    if (idxs.length === bestIdxs.length && rx + ry <= bestRx + bestRy) continue;
    const perSide = sig.length / 16;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of idxs) hit[Math.floor(p / perSide) % 16]++;
    if (hit.filter((v) => v >= 1).length < 10) continue;
    bestIdxs = idxs;
    bestRx = rx;
    bestRy = ry;
    bestN = sig.length;
  }
  if (bestIdxs.length < 12) return [];
  const holes = holesOnCross(lum, w, h, cx, cy, bestRx, bestRy, bestIdxs, bestN, scale);
  return holesAtBoxCorners(holes) ? [] : holes;
}

function inCross(x, y, cx, cy, rx, ry, arm = 0.35) {
  const nx = (x - cx) / rx;
  const ny = (y - cy) / ry;
  return (Math.abs(nx) <= arm && Math.abs(ny) <= 1) || (Math.abs(ny) <= arm && Math.abs(nx) <= 1);
}

function stampCrossFromHoles(holes) {
  if (holes.length < 12) return null;
  if (holesAtBoxCorners(holes) || sidedness(holes, 8) >= 8) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const hole of holes) {
    if (hole.cx < x0) x0 = hole.cx;
    if (hole.cy < y0) y0 = hole.cy;
    if (hole.cx > x1) x1 = hole.cx;
    if (hole.cy > y1) y1 = hole.cy;
  }
  const n = holes.length;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  if (rx < 16 || ry < 16) return null;
  const verts = crossVerts(cx, cy, rx, ry);
  const tol = Math.min(rx, ry) * 0.14;
  const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let inliers = 0;
  for (const hole of holes) {
    let bestD = Infinity;
    let bestS = 0;
    for (let s = 0; s < 16; s++) {
      const d = distToSeg(hole.cx, hole.cy, verts[s][0], verts[s][1], verts[(s + 1) % 16][0], verts[(s + 1) % 16][1]);
      if (d < bestD) {
        bestD = d;
        bestS = s;
      }
    }
    if (bestD > tol) continue;
    inliers++;
    hit[bestS]++;
  }
  if (hit.filter((v) => v >= 1).length < 10) return null;
  if (inliers < 12 || inliers < n * 0.7) return null;
  return { cx, cy, rx: rx * 1.08 + 1.2, ry: ry * 1.08 + 1.2 };
}

function keepHoleCross(lum, holes, cross, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const x0 = Math.max(0, Math.floor(cross.cx - cross.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(cross.cx + cross.rx + 1));
  const y0 = Math.max(0, Math.floor(cross.cy - cross.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(cross.cy + cross.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (inCross(x, y, cross.cx, cross.cy, cross.rx, cross.ry)) alpha[y * w + x] = 255;
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function arrowRaw() {
  const corners = [
    [0, -1],
    [1, -0.2],
    [0.32, -0.2],
    [0.32, 1],
    [-0.32, 1],
    [-0.32, -0.2],
    [-1, -0.2],
    [0, -1],
  ];
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      dense.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function arrowVerts(cx, cy, rx, ry) {
  const dense = arrowRaw();
  const acc = [0];
  for (let i = 1; i < dense.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  const total = acc[acc.length - 1] || 1;
  const raw = [];
  for (let s = 0; s < 16; s++) {
    const target = (s / 16) * total;
    let k = 1;
    while (k < acc.length && acc[k] < target) k++;
    const u = (target - acc[k - 1]) / Math.max(1e-9, acc[k] - acc[k - 1]);
    raw.push([
      dense[k - 1][0] + (dense[k][0] - dense[k - 1][0]) * u,
      dense[k - 1][1] + (dense[k][1] - dense[k - 1][1]) * u,
    ]);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of raw) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const ocx = (x0 + x1) / 2;
  const ocy = (y0 + y1) / 2;
  const orx = (x1 - x0) / 2 || 1;
  const ory = (y1 - y0) / 2 || 1;
  return raw.map(([x, y]) => [cx + ((x - ocx) / orx) * rx, cy + ((y - ocy) / ory) * ry]);
}

function sampleArrowMin(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = arrowVerts(cx, cy, rx, ry);
  const perSide = Math.max(8, Math.round((rx + ry) * 0.28));
  const sig = new Float32Array(perSide * 16);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  let k = 0;
  for (let s = 0; s < 16; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnArrow(lum, w, h, cx, cy, rx, ry, idxs, n, scale) {
  const perSide = n / 16;
  const verts = arrowVerts(cx, cy, rx, ry);
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 16;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const hole = refineHole(lum, w, h, x, y, scale);
    hole.r = Math.min(hole.r, 3.4 * scale);
    holes.push(hole);
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectArrowFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    const sig = sampleArrowMin(lum, w, h, cx, cy, rx, ry);
    const idxs = closedValleyIndexes(sig);
    if (idxs.length < bestIdxs.length) continue;
    if (idxs.length === bestIdxs.length && rx + ry <= bestRx + bestRy) continue;
    const perSide = sig.length / 16;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of idxs) hit[Math.floor(p / perSide) % 16]++;
    if (hit.filter((v) => v >= 1).length < 10) continue;
    bestIdxs = idxs;
    bestRx = rx;
    bestRy = ry;
    bestN = sig.length;
  }
  if (bestIdxs.length < 12) return [];
  const holes = holesOnArrow(lum, w, h, cx, cy, bestRx, bestRy, bestIdxs, bestN, scale);
  return holesAtBoxCorners(holes) ? [] : holes;
}

function inArrow(x, y, cx, cy, rx, ry, shaft = 0.32, neck = -0.2) {
  const nx = (x - cx) / rx;
  const ny = (y - cy) / ry;
  if (ny < -1 || ny > 1) return false;
  if (ny >= neck) return Math.abs(nx) <= shaft;
  const t = (ny + 1) / (neck + 1);
  return Math.abs(nx) <= t;
}

function stampArrowFromHoles(holes) {
  if (holes.length < 12) return null;
  if (holesAtBoxCorners(holes) || sidedness(holes, 8) >= 8) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const hole of holes) {
    if (hole.cx < x0) x0 = hole.cx;
    if (hole.cy < y0) y0 = hole.cy;
    if (hole.cx > x1) x1 = hole.cx;
    if (hole.cy > y1) y1 = hole.cy;
  }
  const n = holes.length;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  if (rx < 16 || ry < 16) return null;
  const verts = arrowVerts(cx, cy, rx, ry);
  const tol = Math.min(rx, ry) * 0.14;
  const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let inliers = 0;
  for (const hole of holes) {
    let bestD = Infinity;
    let bestS = 0;
    for (let s = 0; s < 16; s++) {
      const d = distToSeg(hole.cx, hole.cy, verts[s][0], verts[s][1], verts[(s + 1) % 16][0], verts[(s + 1) % 16][1]);
      if (d < bestD) {
        bestD = d;
        bestS = s;
      }
    }
    if (bestD > tol) continue;
    inliers++;
    hit[bestS]++;
  }
  if (hit.filter((v) => v >= 1).length < 10) return null;
  if (inliers < 12 || inliers < n * 0.7) return null;
  return { cx, cy, rx: rx * 1.08 + 1.2, ry: ry * 1.08 + 1.2 };
}

function keepHoleArrow(lum, holes, arrow, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const x0 = Math.max(0, Math.floor(arrow.cx - arrow.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(arrow.cx + arrow.rx + 1));
  const y0 = Math.max(0, Math.floor(arrow.cy - arrow.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(arrow.cy + arrow.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (inArrow(x, y, arrow.cx, arrow.cy, arrow.rx, arrow.ry)) alpha[y * w + x] = 255;
    }
  }
  punchHoles(alpha, lum, w, h, holes);
  return alpha;
}

function cloudRaw() {
  const corners = [
    [-1.00, 0.20],
    [-0.78, -0.18],
    [-0.42, -0.38],
    [-0.22, -0.78],
    [0.08, -1.00],
    [0.40, -0.72],
    [0.58, -0.32],
    [0.88, -0.18],
    [1.00, 0.18],
    [0.86, 0.58],
    [0.50, 0.88],
    [0.12, 0.70],
    [-0.22, 1.00],
    [-0.62, 0.82],
    [-0.90, 0.52],
    [-1.00, 0.20],
  ];
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      dense.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function cloudVerts(cx, cy, rx, ry) {
  const dense = cloudRaw();
  const acc = [0];
  for (let i = 1; i < dense.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  const total = acc[acc.length - 1] || 1;
  const raw = [];
  for (let s = 0; s < 16; s++) {
    const target = (s / 16) * total;
    let k = 1;
    while (k < acc.length && acc[k] < target) k++;
    const u = (target - acc[k - 1]) / Math.max(1e-9, acc[k] - acc[k - 1]);
    raw.push([
      dense[k - 1][0] + (dense[k][0] - dense[k - 1][0]) * u,
      dense[k - 1][1] + (dense[k][1] - dense[k - 1][1]) * u,
    ]);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of raw) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const ocx = (x0 + x1) / 2;
  const ocy = (y0 + y1) / 2;
  const orx = (x1 - x0) / 2 || 1;
  const ory = (y1 - y0) / 2 || 1;
  return raw.map(([x, y]) => [cx + ((x - ocx) / orx) * rx, cy + ((y - ocy) / ory) * ry]);
}

function sampleCloudMin(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = cloudVerts(cx, cy, rx, ry);
  const perSide = Math.max(8, Math.round((rx + ry) * 0.28));
  const sig = new Float32Array(perSide * 16);
  const band = Math.max(2, Math.min(5, Math.round(Math.min(rx, ry) * 0.05)));
  let k = 0;
  for (let s = 0; s < 16; s++) {
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < perSide; i++) {
      const t = i / perSide;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      let best = 1e9;
      for (let dr = -band; dr <= band; dr++) {
        const x = Math.round(px + nx * dr);
        const y = Math.round(py + ny * dr);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = lum[y * w + x];
        if (v < best) best = v;
      }
      sig[k++] = best === 1e9 ? 255 : best;
    }
  }
  return sig;
}

function holesOnCloud(lum, w, h, cx, cy, rx, ry, idxs, n, scale) {
  const perSide = n / 16;
  const verts = cloudVerts(cx, cy, rx, ry);
  const holes = [];
  for (const p of idxs) {
    const s = Math.floor(p / perSide) % 16;
    const t = (p % perSide) / perSide;
    const x0 = verts[s][0];
    const y0 = verts[s][1];
    const x1 = verts[(s + 1) % 16][0];
    const y1 = verts[(s + 1) % 16][1];
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const hole = refineHole(lum, w, h, x, y, scale);
    hole.r = Math.min(hole.r, 3.4 * scale);
    holes.push(hole);
  }
  const kept = [];
  for (const hole of holes) {
    if (kept.some((other) => (other.cx - hole.cx) ** 2 + (other.cy - hole.cy) ** 2 < 16)) continue;
    kept.push(hole);
  }
  return kept;
}

function detectCloudFamily(lum, w, h, cx, cy, rxMax, ryMax, scale) {
  if (rxMax < 16 || ryMax < 16) return [];
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let bestRx = 0;
  let bestRy = 0;
  let bestN = 0;
  let bestIdxs = [];
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const rx = rxMax * t;
    const ry = ryMax * t;
    const sig = sampleCloudMin(lum, w, h, cx, cy, rx, ry);
    const idxs = closedValleyIndexes(sig);
    if (idxs.length < bestIdxs.length) continue;
    if (idxs.length === bestIdxs.length && rx + ry <= bestRx + bestRy) continue;
    const perSide = sig.length / 16;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of idxs) hit[Math.floor(p / perSide) % 16]++;
    if (hit.filter((v) => v >= 1).length < 10) continue;
    bestIdxs = idxs;
    bestRx = rx;
    bestRy = ry;
    bestN = sig.length;
  }
  if (bestIdxs.length < 12) return [];
  const holes = holesOnCloud(lum, w, h, cx, cy, bestRx, bestRy, bestIdxs, bestN, scale);
  return holesAtBoxCorners(holes) ? [] : holes;
}

function pointInCloud(x, y, verts) {
  let inside = false;
  for (let i = 0, j = 15; i < 16; j = i++) {
    const xi = verts[i][0];
    const yi = verts[i][1];
    const xj = verts[j][0];
    const yj = verts[j][1];
    const hit = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

function stampCloudFromHoles(holes) {
  if (holes.length < 12) return null;
  if (holesAtBoxCorners(holes) || sidedness(holes, 8) >= 8) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const hole of holes) {
    if (hole.cx < x0) x0 = hole.cx;
    if (hole.cy < y0) y0 = hole.cy;
    if (hole.cx > x1) x1 = hole.cx;
    if (hole.cy > y1) y1 = hole.cy;
  }
  const n = holes.length;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  if (rx < 16 || ry < 16) return null;
  const verts = cloudVerts(cx, cy, rx, ry);
  const tol = Math.min(rx, ry) * 0.14;
  const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let inliers = 0;
  for (const hole of holes) {
    let bestD = Infinity;
    let bestS = 0;
    for (let s = 0; s < 16; s++) {
      const d = distToSeg(hole.cx, hole.cy, verts[s][0], verts[s][1], verts[(s + 1) % 16][0], verts[(s + 1) % 16][1]);
      if (d < bestD) {
        bestD = d;
        bestS = s;
      }
    }
    if (bestD > tol) continue;
    inliers++;
    hit[bestS]++;
  }
  if (hit.filter((v) => v >= 1).length < 10) return null;
  if (inliers < 12 || inliers < n * 0.7) return null;
  return { cx, cy, rx: rx * 1.08 + 1.2, ry: ry * 1.08 + 1.2 };
}

function keepHoleCloud(lum, holes, cloud, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  const verts = cloudVerts(cloud.cx, cloud.cy, cloud.rx, cloud.ry);
  const x0 = Math.max(0, Math.floor(cloud.cx - cloud.rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(cloud.cx + cloud.rx + 1));
  const y0 = Math.max(0, Math.floor(cloud.cy - cloud.ry - 1));
  const y1 = Math.min(h - 1, Math.ceil(cloud.cy + cloud.ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pointInCloud(x, y, verts)) alpha[y * w + x] = 255;
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
  const hexHoles = detectHexagonHoles(lum, w, h, scale);
  const ringFit = edgeHoles.concat(ringHoles);
  const octHoles = stampDiskFromHoles(ringFit) ? [] : detectOctagonHoles(lum, w, h, scale);
  const pentHoles = stampDiskFromHoles(ringFit) ? [] : detectPentagonHoles(lum, w, h, scale);
  const triHoles = stampDiskFromHoles(ringFit) ? [] : detectTriangleHoles(lum, w, h, scale);
  const starHoles = stampDiskFromHoles(ringFit) ? [] : detectStarHoles(lum, w, h, scale);
  const heartHoles = stampDiskFromHoles(ringFit) ? [] : detectHeartHoles(lum, w, h, scale);
  const crescentHoles = stampDiskFromHoles(ringFit) ? [] : detectCrescentHoles(lum, w, h, scale);
  const teardropHoles = stampDiskFromHoles(ringFit) ? [] : detectTeardropHoles(lum, w, h, scale);
  const shieldHoles = stampDiskFromHoles(ringFit) ? [] : detectShieldHoles(lum, w, h, scale);
  const crossHoles = stampDiskFromHoles(ringFit) ? [] : detectCrossHoles(lum, w, h, scale);
  const arrowHoles = stampDiskFromHoles(ringFit) ? [] : detectArrowHoles(lum, w, h, scale);
  const cloudHoles = stampDiskFromHoles(ringFit) ? [] : detectCloudHoles(lum, w, h, scale);
  const holes = edgeHoles.concat(ringHoles, hexHoles, octHoles, pentHoles, triHoles, starHoles, heartHoles, crescentHoles, teardropHoles, shieldHoles, crossHoles, arrowHoles, cloudHoles);
  const parts = opaqueParts(fg, w, h);
  const partHoles = parts.map(() => []);
  const partHexHoles = parts.map(() => []);
  const partOctHoles = parts.map(() => []);
  const partPentHoles = parts.map(() => []);
  const partTriHoles = parts.map(() => []);
  const partStarHoles = parts.map(() => []);
  const partHeartHoles = parts.map(() => []);
  const partCrescentHoles = parts.map(() => []);
  const partTeardropHoles = parts.map(() => []);
  const partShieldHoles = parts.map(() => []);
  const partCrossHoles = parts.map(() => []);
  const partArrowHoles = parts.map(() => []);
  const partCloudHoles = parts.map(() => []);
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
    const localHex = detectHexagonHoles(lum, w, h, localScale, search);
    const localOct = stampDiskFromHoles(local) ? [] : detectOctagonHoles(lum, w, h, localScale, search);
    const localPent = stampDiskFromHoles(local) ? [] : detectPentagonHoles(lum, w, h, localScale, search);
    const localTri = stampDiskFromHoles(local) ? [] : detectTriangleHoles(lum, w, h, localScale, search);
    const localStar = stampDiskFromHoles(local) ? [] : detectStarHoles(lum, w, h, localScale, search);
    const localHeart = stampDiskFromHoles(local) ? [] : detectHeartHoles(lum, w, h, localScale, search);
    const localCrescent = stampDiskFromHoles(local) ? [] : detectCrescentHoles(lum, w, h, localScale, search);
    const localTeardrop = stampDiskFromHoles(local) ? [] : detectTeardropHoles(lum, w, h, localScale, search);
    const localShield = stampDiskFromHoles(local) ? [] : detectShieldHoles(lum, w, h, localScale, search);
    const localCross = stampDiskFromHoles(local) ? [] : detectCrossHoles(lum, w, h, localScale, search);
    const localArrow = stampDiskFromHoles(local) ? [] : detectArrowHoles(lum, w, h, localScale, search);
    const localCloud = stampDiskFromHoles(local) ? [] : detectCloudHoles(lum, w, h, localScale, search);
    const take = (hole, dest) => {
      if (!holeNearBox(hole, part, pad)) return;
      if (inset && (hole.cx <= 3 || hole.cy <= 3 || hole.cx >= w - 4 || hole.cy >= h - 4)) return;
      holes.push(hole);
      dest.push(hole);
    };
    for (const hole of local) take(hole, partHoles[p]);
    for (const hole of localHex) take(hole, partHexHoles[p]);
    for (const hole of localOct) take(hole, partOctHoles[p]);
    for (const hole of localPent) take(hole, partPentHoles[p]);
    for (const hole of localTri) take(hole, partTriHoles[p]);
    for (const hole of localStar) take(hole, partStarHoles[p]);
    for (const hole of localHeart) take(hole, partHeartHoles[p]);
    for (const hole of localCrescent) take(hole, partCrescentHoles[p]);
    for (const hole of localTeardrop) take(hole, partTeardropHoles[p]);
    for (const hole of localShield) take(hole, partShieldHoles[p]);
    for (const hole of localCross) take(hole, partCrossHoles[p]);
    for (const hole of localArrow) take(hole, partArrowHoles[p]);
    for (const hole of localCloud) take(hole, partCloudHoles[p]);
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
    for (let i = 0; i < alpha.length; i++) {
      if (restored[i] <= alpha[i]) continue;
      if (alpha[i] < 16 && lum[i] < 80) continue;
      alpha[i] = restored[i];
    }
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
  const paintEllipse = (ell, localHoles, self) => {
    if (!ell) return false;
    const box = {
      x0: ell.cx - ell.rx,
      y0: ell.cy - ell.ry,
      x1: ell.cx + ell.rx,
      y1: ell.cy + ell.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleEllipse(lum, localHoles, ell, w, h));
    return true;
  };
  const paintDiamond = (dia, localHoles, self) => {
    if (!dia) return false;
    const box = {
      x0: dia.cx - dia.rx,
      y0: dia.cy - dia.ry,
      x1: dia.cx + dia.rx,
      y1: dia.cy + dia.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleDiamond(lum, localHoles, dia, w, h));
    return true;
  };
  const paintHexagon = (hex, localHoles, self) => {
    if (!hex) return false;
    const box = {
      x0: hex.cx - hex.rx,
      y0: hex.cy - hex.ry,
      x1: hex.cx + hex.rx,
      y1: hex.cy + hex.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleHexagon(lum, localHoles, hex, w, h));
    return true;
  };
  const paintOctagon = (oct, localHoles, self) => {
    if (!oct) return false;
    const box = {
      x0: oct.cx - oct.rx,
      y0: oct.cy - oct.ry,
      x1: oct.cx + oct.rx,
      y1: oct.cy + oct.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleOctagon(lum, localHoles, oct, w, h));
    return true;
  };
  const paintPentagon = (pent, localHoles, self) => {
    if (!pent) return false;
    const box = {
      x0: pent.cx - pent.rx,
      y0: pent.cy - pent.ry,
      x1: pent.cx + pent.rx,
      y1: pent.cy + pent.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHolePentagon(lum, localHoles, pent, w, h));
    return true;
  };
  const paintTriangle = (tri, localHoles, self) => {
    if (!tri) return false;
    const box = {
      x0: tri.cx - tri.rx,
      y0: tri.cy - tri.ry,
      x1: tri.cx + tri.rx,
      y1: tri.cy + tri.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleTriangle(lum, localHoles, tri, w, h));
    return true;
  };
  const paintStar = (star, localHoles, self) => {
    if (!star) return false;
    const box = {
      x0: star.cx - star.rx,
      y0: star.cy - star.ry,
      x1: star.cx + star.rx,
      y1: star.cy + star.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleStar(lum, localHoles, star, w, h));
    return true;
  };
  const paintHeart = (heart, localHoles, self) => {
    if (!heart) return false;
    const box = {
      x0: heart.cx - heart.rx,
      y0: heart.cy - heart.ry,
      x1: heart.cx + heart.rx,
      y1: heart.cy + heart.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleHeart(lum, localHoles, heart, w, h));
    return true;
  };
  const paintCrescent = (cres, localHoles, self) => {
    if (!cres) return false;
    const box = {
      x0: cres.cx - cres.rx,
      y0: cres.cy - cres.ry,
      x1: cres.cx + cres.rx,
      y1: cres.cy + cres.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleCrescent(lum, localHoles, cres, w, h));
    return true;
  };
  const paintTeardrop = (drop, localHoles, self) => {
    if (!drop) return false;
    const box = {
      x0: drop.cx - drop.rx,
      y0: drop.cy - drop.ry,
      x1: drop.cx + drop.rx,
      y1: drop.cy + drop.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleTeardrop(lum, localHoles, drop, w, h));
    return true;
  };
  const paintShield = (shield, localHoles, self) => {
    if (!shield) return false;
    const box = {
      x0: shield.cx - shield.rx,
      y0: shield.cy - shield.ry,
      x1: shield.cx + shield.rx,
      y1: shield.cy + shield.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleShield(lum, localHoles, shield, w, h));
    return true;
  };
  const paintCross = (cross, localHoles, self) => {
    if (!cross) return false;
    const box = {
      x0: cross.cx - cross.rx,
      y0: cross.cy - cross.ry,
      x1: cross.cx + cross.rx,
      y1: cross.cy + cross.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleCross(lum, localHoles, cross, w, h));
    return true;
  };
  const paintArrow = (arrow, localHoles, self) => {
    if (!arrow) return false;
    const box = {
      x0: arrow.cx - arrow.rx,
      y0: arrow.cy - arrow.ry,
      x1: arrow.cx + arrow.rx,
      y1: arrow.cy + arrow.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleArrow(lum, localHoles, arrow, w, h));
    return true;
  };
  const paintCloud = (cloud, localHoles, self) => {
    if (!cloud) return false;
    const box = {
      x0: cloud.cx - cloud.rx,
      y0: cloud.cy - cloud.ry,
      x1: cloud.cx + cloud.rx,
      y1: cloud.cy + cloud.ry,
    };
    if (!lightMarginEaten(body, lum, box, w, h)) return false;
    if (self && coversOther(box, self)) return false;
    paintMask(keepHoleCloud(lum, localHoles, cloud, w, h));
    return true;
  };
  const paintPiece = (localHoles, hexLocal, octLocal, pentLocal, triLocal, starLocal, heartLocal, crescentLocal, teardropLocal, shieldLocal, crossLocal, arrowLocal, cloudLocal, self) => {
    if (paintDisk(stampDiskFromHoles(localHoles), localHoles, self)) return;
    if (paintEllipse(stampEllipseFromHoles(localHoles), localHoles, self)) return;
    if (paintDiamond(stampDiamondFromHoles(localHoles), localHoles, self)) return;
    if (paintOctagon(stampOctagonFromHoles(octLocal), octLocal, self)) return;
    if (paintHexagon(stampHexagonFromHoles(hexLocal), hexLocal, self)) return;
    if (paintPentagon(stampPentagonFromHoles(pentLocal), pentLocal, self)) return;
    if (paintTriangle(stampTriangleFromHoles(triLocal), triLocal, self)) return;
    if (paintStar(stampStarFromHoles(starLocal), starLocal, self)) return;
    if (paintHeart(stampHeartFromHoles(heartLocal), heartLocal, self)) return;
    if (paintCrescent(stampCrescentFromHoles(crescentLocal), crescentLocal, self)) return;
    if (paintTeardrop(stampTeardropFromHoles(teardropLocal), teardropLocal, self)) return;
    if (paintShield(stampShieldFromHoles(shieldLocal), shieldLocal, self)) return;
    if (paintCross(stampCrossFromHoles(crossLocal), crossLocal, self)) return;
    if (paintArrow(stampArrowFromHoles(arrowLocal), arrowLocal, self)) return;
    if (paintCloud(stampCloudFromHoles(cloudLocal), cloudLocal, self)) return;
    paintRect(stampRectFromHoles(localHoles, w, h), localHoles, self);
  };
  if (parts.length < 2) paintPiece(edgeHoles.concat(ringHoles), edgeHoles.concat(hexHoles), octHoles, pentHoles, triHoles, starHoles, heartHoles, crescentHoles, teardropHoles, shieldHoles, crossHoles, arrowHoles, cloudHoles, null);
  for (let p = 0; p < parts.length; p++) {
    paintPiece(partHoles[p], partHexHoles[p], partOctHoles[p], partPentHoles[p], partTriHoles[p], partStarHoles[p], partHeartHoles[p], partCrescentHoles[p], partTeardropHoles[p], partShieldHoles[p], partCrossHoles[p], partArrowHoles[p], partCloudHoles[p], parts[p]);
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
