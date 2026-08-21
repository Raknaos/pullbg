/** Cheap local vision: pick the same pipelines we validated by hand. */

function lumAt(data, i) {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

function lumaMap(image) {
  const { data, width: w, height: h } = image;
  const lum = new Float32Array(w * h);
  for (let p = 0, i = 0; p < lum.length; p++, i += 4) lum[p] = lumAt(data, i);
  return lum;
}

function flatColorStats(image) {
  const { data, width: w, height: h } = image;
  const bins = new Map();
  let saturated = 0;
  let top = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 90) continue;
    saturated++;
    const key = `${r >> 5}:${g >> 5}:${b >> 5}`;
    const count = (bins.get(key) || 0) + 1;
    bins.set(key, count);
    if (count > top) top = count;
  }
  const n = w * h;
  return {
    fraction: saturated / n,
    dominance: saturated ? top / saturated : 0,
  };
}

function borderStats(lum, data, w, h) {
  let n = 0;
  let dark = 0;
  let white = 0;
  let sum = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  const add = (x, y) => {
    const v = lum[y * w + x];
    const i = (y * w + x) * 4;
    n++;
    sum += v;
    rSum += data[i];
    gSum += data[i + 1];
    bSum += data[i + 2];
    if (v < 60) dark++;
    if (v > 245) white++;
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    add(x, 1);
    add(x, h - 1);
    add(x, h - 2);
  }
  for (let y = 0; y < h; y++) {
    add(0, y);
    add(1, y);
    add(w - 1, y);
    add(w - 2, y);
  }
  const meanR = rSum / n;
  const meanG = gSum / n;
  const meanB = bSum / n;
  return {
    darkFrac: dark / n,
    whiteFrac: white / n,
    mean: sum / n,
    meanR,
    meanG,
    meanB,
    chroma: Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB),
    n,
  };
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

function backdropFlood(data, w, h, maxDist = 32, maxStep = 18) {
  const n = w * h;
  const seeds = cornerSeeds(data, w, h);
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
  let all = 0;
  for (let i = 0; i < n; i++) if (bg[i]) all++;
  return all / n;
}

function interiorMass(lum, w, h, pred, minFrac) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const minArea = Math.max(80, Math.floor(n * minFrac));
  const minPane = Math.max(80, Math.floor(n * 0.008));
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  let largest = 0;
  let total = 0;
  let count = 0;
  let rectangular = 0;
  const panes = [];
  const rounds = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const s = y * w + x;
      if (!pred(lum[s]) || seen[s]) continue;
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
      seen[s] = 1;
      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
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
          if (!pred(lum[ni]) || seen[ni]) continue;
          seen[ni] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }
      if (border) continue;
      const bw = x1 - x0 + 1;
      const bh = y1 - y0 + 1;
      const bbox = bw * bh;
      const fill = bbox > 0 ? area / bbox : 0;
      const pane = fill >= 0.72 && area >= minPane;
      if (fill >= 0.88 && area >= minPane) {
        rectangular++;
        panes.push({ x0, y0, x1, y1, area });
      } else if (
        fill >= 0.68
        && fill <= 0.92
        && area >= minPane
        && (bw >= bh ? bw / bh : bh / bw) <= 2.6
      ) {
        rounds.push({ x0, y0, x1, y1, area });
      }
      if (!pane && area < minArea) continue;
      total += area;
      count++;
      if (area > largest) largest = area;
    }
  }
  return { largest: largest / n, total: total / n, count, rectangular, panes, rounds };
}

function paneMean(data, w, pane) {
  const bw = pane.x1 - pane.x0 + 1;
  const bh = pane.y1 - pane.y0 + 1;
  const ix = Math.min(Math.max(0, Math.floor(bw * 0.18)), Math.max(0, Math.floor((bw - 1) / 2)));
  const iy = Math.min(Math.max(0, Math.floor(bh * 0.18)), Math.max(0, Math.floor((bh - 1) / 2)));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = pane.y0 + iy; y <= pane.y1 - iy; y++) {
    for (let x = pane.x0 + ix; x <= pane.x1 - ix; x++) {
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

function skyLikeCount(image, panes) {
  let n = 0;
  for (const pane of panes) {
    const [r, g, b] = paneMean(image.data, image.width, pane);
    if (b >= r + 18 && b >= 70) n++;
  }
  return n;
}

function glassLike(image, pane) {
  const [r, g, b] = paneMean(image.data, image.width, pane);
  if (b >= r + 18 && b >= 70) return true;
  if (g >= r + 18 && g >= b + 12 && g >= 50) return true;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum >= 220 && b >= r - 4) return true;
  if (lum <= 46 && Math.max(r, g, b) - Math.min(r, g, b) < 28) return true;
  if (warmGlassRgb(r, g, b)) return true;
  return coolGlassRgb(r, g, b);
}

function nightGlass(image, pane) {
  const [r, g, b] = paneMean(image.data, image.width, pane);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum <= 46 && Math.max(r, g, b) - Math.min(r, g, b) < 28;
}

function warmGlassRgb(r, g, b) {
  return r >= 90 && r >= g + 16 && r >= b + 22 && g >= 36;
}

function warmGlass(image, pane) {
  const [r, g, b] = paneMean(image.data, image.width, pane);
  if (b >= r + 18 && b >= 70) return false;
  if (g >= r + 18 && g >= b + 12 && g >= 50) return false;
  return warmGlassRgb(r, g, b);
}

function coolGlassRgb(r, g, b) {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return lum >= 52 && lum <= 215
    && chroma <= 36
    && b >= r + 6
    && b >= g - 2
    && !(b >= r + 18 && b >= 70);
}

function coolGlass(image, pane) {
  const [r, g, b] = paneMean(image.data, image.width, pane);
  if (b >= r + 18 && b >= 70) return false;
  if (g >= r + 18 && g >= b + 12 && g >= 50) return false;
  if (warmGlassRgb(r, g, b)) return false;
  return coolGlassRgb(r, g, b);
}

function coloredFrame(border) {
  if (!border) return false;
  if (border.whiteFrac >= 0.45 || border.mean >= 200) return false;
  if (border.darkFrac >= 0.42 && border.mean < 75) return false;
  return border.chroma >= 8;
}

function singleGlassPane(image, panes, w, h, border) {
  const glass = [];
  for (const p of panes) if (glassLike(image, p)) glass.push(p);
  if (glass.length !== 1) return false;
  const p = glass[0];
  if ((nightGlass(image, p) || warmGlass(image, p)) && !coloredFrame(border)) return false;
  if (coolGlass(image, p) && !coloredFrame(border) && border.whiteFrac < 0.45 && border.mean < 200) return false;
  const n = w * h;
  return p.area / n >= 0.12
    && (p.x1 - p.x0 + 1) / w >= 0.55
    && (p.y1 - p.y0 + 1) / h >= 0.55;
}

function singleRoundGlass(image, rounds, w, h, border) {
  if (rounds.length !== 1) return false;
  if (border.whiteFrac >= 0.45 || border.mean >= 200) return false;
  if (border.chroma < 8) return false;
  if (!glassLike(image, rounds[0])) return false;
  const p = rounds[0];
  const n = w * h;
  const bw = p.x1 - p.x0 + 1;
  const bh = p.y1 - p.y0 + 1;
  if (p.area / n >= 0.12 && bw / w >= 0.5 && bh / h >= 0.5) return true;
  const wide = Math.max(bw, bh);
  const tall = Math.min(bw, bh);
  return p.area / n >= 0.08
    && wide / Math.min(w, h) >= 0.55
    && tall / Math.max(w, h) >= 0.22
    && wide / tall >= 1.35;
}

function similarPaneCount(image, panes) {
  if (panes.length < 2) return 0;
  const means = panes.map((p) => paneMean(image.data, image.width, p));
  const used = new Uint8Array(panes.length);
  let best = 0;
  for (let i = 0; i < panes.length; i++) {
    if (used[i]) continue;
    let n = 1;
    used[i] = 1;
    for (let j = i + 1; j < panes.length; j++) {
      if (used[j]) continue;
      const ratio = panes[i].area >= panes[j].area
        ? panes[i].area / panes[j].area
        : panes[j].area / panes[i].area;
      if (ratio > 2.8) continue;
      const dist = Math.max(
        Math.abs(means[i][0] - means[j][0]),
        Math.abs(means[i][1] - means[j][1]),
        Math.abs(means[i][2] - means[j][2]),
      );
      if (dist > 48) continue;
      used[j] = 1;
      n++;
    }
    if (n > best) best = n;
  }
  return best;
}

function gapMatchesBorder(data, w, panes, br, bg, bb) {
  if (panes.length < 2) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of panes) {
    if (p.x0 < minX) minX = p.x0;
    if (p.y0 < minY) minY = p.y0;
    if (p.x1 > maxX) maxX = p.x1;
    if (p.y1 > maxY) maxY = p.y1;
  }
  let n = 0;
  let hit = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inPane = false;
      for (const p of panes) {
        if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) {
          inPane = true;
          break;
        }
      }
      if (inPane) continue;
      const i = (y * w + x) * 4;
      const dist = Math.max(
        Math.abs(data[i] - br),
        Math.abs(data[i + 1] - bg),
        Math.abs(data[i + 2] - bb),
      );
      n++;
      if (dist <= 24) hit++;
    }
  }
  return n >= 20 && hit / n >= 0.72;
}

function panesFillFrame(panes, w, h) {
  if (panes.length < 2) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of panes) {
    if (p.x0 < minX) minX = p.x0;
    if (p.y0 < minY) minY = p.y0;
    if (p.x1 > maxX) maxX = p.x1;
    if (p.y1 > maxY) maxY = p.y1;
  }
  return (maxX - minX + 1) / w >= 0.7 && (maxY - minY + 1) / h >= 0.7;
}

function darkRegularHoles(sig) {
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
  if (idxs.length < 8) return 0;
  const gaps = [];
  let sum = 0;
  for (let k = 1; k < idxs.length; k++) {
    const g = idxs[k] - idxs[k - 1];
    gaps.push(g);
    sum += g;
  }
  const mean = sum / gaps.length;
  if (mean < 7) return 0;
  let v = 0;
  for (const g of gaps) v += (g - mean) * (g - mean);
  if (Math.sqrt(v / gaps.length) / mean > 0.5) return 0;
  return idxs.length;
}

function edgePeakHint(lum, w, h, box) {
  const x0 = box ? Math.max(0, box.x0 | 0) : 0;
  const y0 = box ? Math.max(0, box.y0 | 0) : 0;
  const x1 = box ? Math.min(w, box.x1 | 0) : w;
  const y1 = box ? Math.min(h, box.y1 | 0) : h;
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw < 32 || rh < 32) return { sides: [0, 0, 0, 0], total: 0, stampedSides: 0 };
  const strip = Math.max(8, Math.round(Math.min(rw, rh) * 0.04));
  const top = new Float32Array(rw);
  const bot = new Float32Array(rw);
  const left = new Float32Array(rh);
  const right = new Float32Array(rh);
  top.fill(1e9);
  bot.fill(1e9);
  left.fill(1e9);
  right.fill(1e9);
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
  const sides = [darkRegularHoles(top), darkRegularHoles(bot), darkRegularHoles(left), darkRegularHoles(right)];
  return {
    sides,
    total: sides.reduce((a, b) => a + b, 0),
    stampedSides: sides.filter((n) => n >= 8).length,
  };
}

function darkSubjectBoxes(lum, w, h, floor) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  const boxes = [];
  const minArea = Math.max(80, Math.floor(n * 0.01));
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const s = y * w + x;
      if (lum[s] >= floor || seen[s]) continue;
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
          if (lum[ni] >= floor || seen[ni]) continue;
          seen[ni] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }
      if (area < minArea || x1 - x0 < 24 || y1 - y0 < 24) continue;
      boxes.push({ x0, y0, x1: x1 + 1, y1: y1 + 1 });
    }
  }
  return boxes;
}

function looksLikeStamp(peaks) {
  return peaks.stampedSides >= 2 && peaks.total >= 16;
}

export function classifyImage(image) {
  const { width: w, height: h } = image;
  const lum = lumaMap(image);
  const border = borderStats(lum, image.data, w, h);
  const paneBlack = Math.max(14, Math.min(50, border.mean - 8));
  const paneWhite = Math.min(248, Math.max(234, border.mean + 40));
  const interiorBlack = interiorMass(lum, w, h, (v) => v <= paneBlack, 0.025);
  const interiorWhite = interiorMass(lum, w, h, (v) => v >= paneWhite, 0.025);
  const interiorMid = interiorMass(
    lum,
    w,
    h,
    (v) => v > paneBlack && v < paneWhite && Math.abs(v - border.mean) >= 16,
    0.025,
  );
  const tint = new Float32Array(w * h);
  const data = image.data;
  for (let p = 0, i = 0; p < tint.length; p++, i += 4) {
    const dist = Math.max(
      Math.abs(data[i] - border.meanR),
      Math.abs(data[i + 1] - border.meanG),
      Math.abs(data[i + 2] - border.meanB),
    );
    tint[p] = dist >= 16 && lum[p] < paneWhite ? 255 : 0;
  }
  const interiorTint = interiorMass(tint, w, h, (v) => v > 0, 0.025);
  const peaks = edgePeakHint(lum, w, h);
  const flatColor = flatColorStats(image);
  let looksStamp = looksLikeStamp(peaks);
  if (looksStamp && border.whiteFrac >= 0.45) looksStamp = false;
  if (!looksStamp && border.mean >= 150 && border.darkFrac < 0.22) {
    const floor = Math.min(200, border.mean - 36);
    for (const box of darkSubjectBoxes(lum, w, h, floor)) {
      const pad = Math.max(12, Math.round(Math.min(box.x1 - box.x0, box.y1 - box.y0) * 0.35));
      const search = {
        x0: Math.max(0, box.x0 - pad),
        y0: Math.max(0, box.y0 - pad),
        x1: Math.min(w, box.x1 + pad),
        y1: Math.min(h, box.y1 + pad),
      };
      if (!looksLikeStamp(edgePeakHint(lum, w, h, search))) continue;
      const inset = box.x0 > 6 && box.y0 > 6 && box.x1 < w - 6 && box.y1 < h - 6;
      const reachedBorder = search.x0 <= 0 || search.y0 <= 0 || search.x1 >= w || search.y1 >= h;
      if (inset && reachedBorder) {
        const inner = {
          x0: Math.max(search.x0, 4),
          y0: Math.max(search.y0, 4),
          x1: Math.min(search.x1, w - 4),
          y1: Math.min(search.y1, h - 4),
        };
        if (!looksLikeStamp(edgePeakHint(lum, w, h, inner))) continue;
      }
      looksStamp = true;
      break;
    }
  }
  const closedBlack = interiorBlack.largest >= 0.12 || interiorBlack.total >= 0.16;
  const closedWhite = interiorWhite.largest >= 0.12 || interiorWhite.total >= 0.16;
  const lightBackdrop = border.whiteFrac >= 0.45 || border.mean >= 200;
  const tightBlack = panesFillFrame(interiorBlack.panes, w, h);
  const darkPanes =
    interiorBlack.rectangular >= 2 &&
    interiorBlack.total >= 0.1 &&
    (!lightBackdrop || interiorBlack.rectangular >= 4 || tightBlack);
  const multiPane =
    darkPanes ||
    (interiorMid.rectangular >= 2 && interiorMid.total >= 0.08) ||
    (interiorTint.rectangular >= 2 && interiorTint.total >= 0.08 && border.darkFrac < 0.4 && border.mean >= 50);
  const gridPanes = interiorTint.rectangular >= interiorMid.rectangular ? interiorTint.panes : interiorMid.panes;
  const tightGrid = panesFillFrame(gridPanes, w, h);
  const lightGrid =
    gridPanes.length >= 2 &&
    (interiorTint.total >= 0.08 || interiorMid.total >= 0.08) &&
    gapMatchesBorder(image.data, w, gridPanes, border.meanR, border.meanG, border.meanB) &&
    (similarPaneCount(image, gridPanes) >= 2 || tightGrid) &&
    (!lightBackdrop || skyLikeCount(image, gridPanes) >= 2 || gridPanes.length >= 4 || tightGrid);
  const singleGlass =
    singleGlassPane(image, interiorTint.panes, w, h, border) ||
    singleGlassPane(image, interiorMid.panes, w, h, border) ||
    singleRoundGlass(image, interiorTint.rounds, w, h, border) ||
    singleRoundGlass(image, interiorMid.rounds, w, h, border);

  if (looksStamp && border.darkFrac >= 0.25) {
    return { kind: "timbre photo", mode: "timbre", interior: false, reason: "fond sombre + dentelé" };
  }
  if (looksStamp) {
    return { kind: "timbre scan", mode: "timbre", interior: false, reason: `dentelé (${peaks.stampedSides} bords, ${peaks.total} trous)` };
  }
  if ((closedBlack && border.darkFrac >= 0.15) || darkPanes || lightGrid || singleGlass || (multiPane && border.whiteFrac < 0.55 && !lightBackdrop)) {
    return { kind: "fenêtre / écran", mode: "noir", interior: true, reason: "grand rectangle noir fermé (lecteur, UI)" };
  }
  if (closedWhite && border.whiteFrac < 0.55 && (border.chroma < 50 || interiorWhite.largest >= 0.4)) {
    return { kind: "fenêtre / page", mode: "aucun", interior: true, reason: "grande page blanche fermée dans un cadre" };
  }
  if (border.darkFrac >= 0.42 && border.mean < 75 && border.chroma < 48) {
    return { kind: "objet sur fond noir", mode: "noir", interior: false, reason: "bords très sombres" };
  }
  if (
    border.whiteFrac >= 0.45 &&
    flatColor.fraction >= 0.05 &&
    flatColor.fraction <= 0.65 &&
    flatColor.dominance >= 0.72
  ) {
    return {
      kind: "graphique couleur",
      mode: "couleur",
      interior: false,
      reason: `couleur dominante (${Math.round(flatColor.dominance * 100)} % des pixels saturés)`,
    };
  }
  if (border.whiteFrac >= 0.45) {
    return { kind: "objet / produit", mode: "ia", interior: false, reason: "fond clair, IA générale" };
  }
  const back = backdropFlood(image.data, w, h);
  if (back >= 0.55 && back <= 0.92) {
    return { kind: "fond uni", mode: "fond", interior: false, reason: "fond de studio (uni ou dégradé)" };
  }
  return { kind: "général", mode: "ia", interior: false, reason: "pas de motif spécial, IA par défaut" };
}
