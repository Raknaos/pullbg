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
      const aspect = bw >= bh ? bw / bh : bh / bw;
      const emptyTL = !pred(lum[y0 * w + x0]);
      const emptyTR = !pred(lum[y0 * w + x1]);
      const emptyBL = !pred(lum[y1 * w + x0]);
      const emptyBR = !pred(lum[y1 * w + x1]);
      const emptyN = (emptyTL ? 1 : 0) + (emptyTR ? 1 : 0) + (emptyBL ? 1 : 0) + (emptyBR ? 1 : 0);
      const lozenge = fill >= 0.36 && fill < 0.68 && aspect <= 2.2 && emptyN === 4;
      const triangle = fill >= 0.42 && fill < 0.68 && aspect <= 2.2 && emptyN === 2
        && ((emptyTL && emptyTR) || (emptyBL && emptyBR) || (emptyTL && emptyBL) || (emptyTR && emptyBR));
      if (fill >= 0.88 && area >= minPane) {
        rectangular++;
        panes.push({ x0, y0, x1, y1, area });
      } else if (
        area >= minPane
        && (
          (fill >= 0.68 && fill <= 0.92 && aspect <= 2.6)
          || lozenge
          || triangle
        )
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

function multiRoundGlass(image, rounds, w, h, border) {
  if (rounds.length < 2) return false;
  if (!coloredFrame(border)) return false;
  if (border.whiteFrac >= 0.45 || border.mean >= 200) return false;
  const glass = [];
  for (const p of rounds) if (glassLike(image, p)) glass.push(p);
  if (glass.length < 2) return false;
  let area = 0;
  for (const p of glass) area += p.area;
  if (area / (w * h) < 0.08) return false;
  return glass.length >= 3 || panesFillFrame(glass, w, h);
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

function sampleRing(lum, w, h, cx, cy, rx, ry = rx) {
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

function ellipseHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const n = darkRegularHoles(sampleRing(lum, w, h, cx, cy, rxMax * t, ryMax * t));
    if (n > best) best = n;
  }
  return best;
}

function sampleDiamond(lum, w, h, cx, cy, rx, ry) {
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

function diamondHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const n = darkRegularHoles(sampleDiamond(lum, w, h, cx, cy, rxMax * t, ryMax * t));
    if (n > best) best = n;
  }
  return best;
}

function hexagonVerts(cx, cy, rx, ry, flat) {
  return flat
    ? [[cx + rx, cy], [cx + rx * 0.5, cy + ry], [cx - rx * 0.5, cy + ry], [cx - rx, cy], [cx - rx * 0.5, cy - ry], [cx + rx * 0.5, cy - ry]]
    : [[cx, cy - ry], [cx + rx, cy - ry * 0.5], [cx + rx, cy + ry * 0.5], [cx, cy + ry], [cx - rx, cy + ry * 0.5], [cx - rx, cy - ry * 0.5]];
}

function sampleHexagon(lum, w, h, cx, cy, rx, ry, flat) {
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

function hexagonHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    for (const flat of [false, true]) {
      const sig = sampleHexagon(lum, w, h, cx, cy, rxMax * t, ryMax * t, flat);
      const n = darkRegularHoles(sig);
      if (n < 12 || n <= best) continue;
      const win = 6;
      const hit = [0, 0, 0, 0, 0, 0];
      const perSide = sig.length / 6;
      for (let i = win; i < sig.length - win; i++) {
        const valley = sig[i];
        if (valley > 78) continue;
        if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
        hit[Math.floor(i / perSide) % 6]++;
        i += 5;
      }
      if (hit.every((v) => v >= 2)) best = n;
    }
  }
  return best;
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

function sampleOctagon(lum, w, h, cx, cy, rx, ry) {
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

function octagonHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleOctagon(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 6;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 8;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      const u = ((i % perSide) / perSide);
      if (u > 0.2 && u < 0.8) hit[Math.floor(i / perSide) % 8]++;
      i += 5;
    }
    if (hit.every((v) => v >= 2)) best = n;
  }
  return best;
}

function pentagonVerts(cx, cy, rx, ry) {
  const verts = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    verts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return verts;
}

function samplePentagon(lum, w, h, cx, cy, rx, ry) {
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

function pentagonHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = samplePentagon(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 6;
    const hit = [0, 0, 0, 0, 0];
    const perSide = sig.length / 5;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 5]++;
      i += 5;
    }
    if (hit.every((v) => v >= 2)) best = n;
  }
  return best;
}

function triangleVerts(cx, cy, rx, ry, flip) {
  return flip
    ? [[cx, cy + ry], [cx + rx, cy - ry], [cx - rx, cy - ry]]
    : [[cx, cy - ry], [cx - rx, cy + ry], [cx + rx, cy + ry]];
}

function sampleTriangle(lum, w, h, cx, cy, rx, ry, flip) {
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

function triangleHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    for (const flip of [false, true]) {
      const sig = sampleTriangle(lum, w, h, cx, cy, rxMax * t, ryMax * t, flip);
      const n = darkRegularHoles(sig);
      if (n < 12 || n <= best) continue;
      const win = 6;
      const hit = [0, 0, 0];
      const perSide = sig.length / 3;
      for (let i = win; i < sig.length - win; i++) {
        const valley = sig[i];
        if (valley > 78) continue;
        if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
        hit[Math.floor(i / perSide) % 3]++;
        i += 5;
      }
      if (hit.every((v) => v >= 4)) best = n;
    }
  }
  return best;
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

function sampleStar(lum, w, h, cx, cy, rx, ry, inner) {
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

function starHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    for (const inner of [0.36, 0.4, 0.43, 0.48]) {
      const sig = sampleStar(lum, w, h, cx, cy, rxMax * t, ryMax * t, inner);
      const n = darkRegularHoles(sig);
      if (n < 12 || n <= best) continue;
      const win = 5;
      const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const perSide = sig.length / 10;
      for (let i = win; i < sig.length - win; i++) {
        const valley = sig[i];
        if (valley > 78) continue;
        if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
        hit[Math.floor(i / perSide) % 10]++;
        i += 4;
      }
      if (hit.filter((v) => v >= 1).length >= 8) best = n;
    }
  }
  return best;
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

function sampleHeart(lum, w, h, cx, cy, rx, ry) {
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

function heartHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleHeart(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function rotCrescent(x, y, dir) {
  if (dir === 1) return [-x, y];
  if (dir === 2) return [y, -x];
  if (dir === 3) return [-y, x];
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

function sampleCrescent(lum, w, h, cx, cy, rx, ry, inner, shift, dir) {
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

function crescentHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    for (const dir of [0, 1, 2, 3]) {
      for (const [inner, shift] of [[0.72, 0.4], [0.78, 0.36]]) {
        const sig = sampleCrescent(lum, w, h, cx, cy, rxMax * t, ryMax * t, inner, shift, dir);
        const n = darkRegularHoles(sig);
        if (n < 12 || n <= best) continue;
        const win = 5;
        const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        const perSide = sig.length / 16;
        for (let i = win; i < sig.length - win; i++) {
          const valley = sig[i];
          if (valley > 78) continue;
          if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
          hit[Math.floor(i / perSide) % 16]++;
          i += 4;
        }
        if (hit.filter((v) => v >= 1).length >= 10) best = n;
      }
    }
  }
  return best;
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

function sampleTeardrop(lum, w, h, cx, cy, rx, ry) {
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

function teardropHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleTeardrop(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
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

function sampleShield(lum, w, h, cx, cy, rx, ry) {
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

function shieldHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleShield(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
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

function sampleCross(lum, w, h, cx, cy, rx, ry) {
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

function crossHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleCross(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
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

function sampleArrow(lum, w, h, cx, cy, rx, ry) {
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

function arrowHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleArrow(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
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

function sampleCloud(lum, w, h, cx, cy, rx, ry) {
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

function cloudHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleCloud(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function cloverRaw() {
  const degs = [0, 20, 40, 60, 80, 120, 140, 160, 180, 200, 240, 260, 280, 300, 320, 340];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const r = 0.62 + 0.38 * Math.cos(3 * t);
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function cloverVerts(cx, cy, rx, ry) {
  const dense = cloverRaw();
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

function sampleClover(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = cloverVerts(cx, cy, rx, ry);
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

function cloverHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleClover(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function flowerRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const r = 0.58 + 0.42 * Math.cos(5 * t);
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function flowerVerts(cx, cy, rx, ry) {
  const dense = flowerRaw();
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

function sampleFlower(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = flowerVerts(cx, cy, rx, ry);
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

function flowerHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleFlower(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function butterflyRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const lobe = Math.abs(Math.sin(2 * t));
    const upper = Math.max(0, -Math.sin(t));
    const r = 0.38 + 0.44 * lobe + 0.2 * upper;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function butterflyVerts(cx, cy, rx, ry) {
  const dense = butterflyRaw();
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

function sampleButterfly(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = butterflyVerts(cx, cy, rx, ry);
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

function butterflyHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleButterfly(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function leafRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const lobes = Math.pow(Math.abs(Math.cos(2.5 * t)), 0.45);
    const top = Math.max(0, -Math.sin(t));
    const stem = Math.max(0, Math.sin(t));
    const thinStem = stem * Math.max(0, 1 - 3 * Math.abs(Math.cos(t)));
    const r = 0.22 + 0.55 * lobes + 0.2 * top * (1 - 0.5 * Math.abs(Math.cos(t))) + 0.28 * thinStem;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function leafVerts(cx, cy, rx, ry) {
  const dense = leafRaw();
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

function sampleLeaf(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = leafVerts(cx, cy, rx, ry);
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

function leafHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleLeaf(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function fishRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const head = Math.max(0, Math.cos(t));
    const tail = Math.max(0, -Math.cos(t));
    const fork = tail * Math.abs(Math.sin(2 * t));
    const dorsal = Math.max(0, Math.sin(t)) * Math.exp(-8 * Math.cos(t) * Math.cos(t));
    const ventral = Math.max(0, -Math.sin(t)) * Math.exp(-10 * Math.cos(t) * Math.cos(t)) * 0.55;
    const r = 0.28 + 0.30 * head + 0.48 * fork + 0.24 * dorsal + 0.14 * ventral;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function fishVerts(cx, cy, rx, ry) {
  const dense = fishRaw();
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

function sampleFish(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = fishVerts(cx, cy, rx, ry);
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

function fishHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleFish(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function birdRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const beak = Math.max(0, Math.cos(t)) * Math.exp(-16 * Math.sin(t) * Math.sin(t));
    const nape = Math.max(0, -Math.sin(t)) * Math.max(0, Math.cos(t) - 0.15);
    const tail = Math.max(0, -Math.cos(t)) * Math.exp(-2.2 * Math.sin(t) * Math.sin(t));
    const wing = Math.max(0, -Math.sin(t)) * Math.exp(-7 * (Math.cos(t) + 0.35) * (Math.cos(t) + 0.35));
    const breast = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t) + 0.2);
    const r = 0.24 + 0.50 * beak + 0.14 * nape + 0.44 * tail + 0.34 * wing + 0.18 * breast;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function birdVerts(cx, cy, rx, ry) {
  const dense = birdRaw();
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

function sampleBird(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = birdVerts(cx, cy, rx, ry);
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

function birdHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleBird(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function catRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const earL = Math.max(0, -Math.sin(t)) * Math.exp(-18 * (Math.cos(t) + 0.38) * (Math.cos(t) + 0.38));
    const earR = Math.max(0, -Math.sin(t)) * Math.exp(-18 * (Math.cos(t) - 0.38) * (Math.cos(t) - 0.38));
    const muzzle = Math.max(0, Math.cos(t)) * Math.max(0, Math.sin(t) + 0.15) * Math.exp(-6 * Math.sin(t) * Math.sin(t));
    const tail = Math.max(0, -Math.cos(t)) * Math.exp(-2.6 * (Math.sin(t) - 0.15) * (Math.sin(t) - 0.15));
    const chest = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t) + 0.25);
    const r = 0.24 + 0.46 * earL + 0.46 * earR + 0.22 * muzzle + 0.40 * tail + 0.16 * chest;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function catVerts(cx, cy, rx, ry) {
  const dense = catRaw();
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

function sampleCat(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = catVerts(cx, cy, rx, ry);
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

function catHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleCat(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}


function dogRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const snout = Math.max(0, Math.cos(t)) * Math.exp(-2.8 * (Math.sin(t) + 0.08) * (Math.sin(t) + 0.08));
    const brow = Math.max(0, Math.cos(t)) * Math.max(0, -Math.sin(t)) * Math.exp(-8 * (Math.sin(t) + 0.45) * (Math.sin(t) + 0.45));
    const ear = Math.max(0, -Math.sin(t)) * Math.exp(-10 * (Math.cos(t) + 0.22) * (Math.cos(t) + 0.22));
    const tail = Math.max(0, -Math.cos(t)) * Math.max(0, -Math.sin(t) + 0.2) * Math.exp(-4.2 * (Math.sin(t) + 0.15) * (Math.sin(t) + 0.15));
    const chest = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t) + 0.15);
    const rump = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t) + 0.1);
    const r = 0.22 + 0.56 * snout + 0.12 * brow + 0.40 * ear + 0.44 * tail + 0.18 * chest + 0.14 * rump;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function dogVerts(cx, cy, rx, ry) {
  const dense = dogRaw();
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

function sampleDog(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = dogVerts(cx, cy, rx, ry);
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

function dogHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleDog(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function rabbitRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const earL = Math.max(0, -Math.sin(t)) * Math.exp(-42 * (Math.cos(t) + 0.24) * (Math.cos(t) + 0.24));
    const earR = Math.max(0, -Math.sin(t)) * Math.exp(-42 * (Math.cos(t) - 0.24) * (Math.cos(t) - 0.24));
    const head = Math.max(0, Math.cos(t)) * Math.max(0, -Math.sin(t) + 0.25) * Math.exp(-4.5 * (Math.sin(t) + 0.12) * (Math.sin(t) + 0.12));
    const tail = Math.max(0, -Math.cos(t)) * Math.max(0, Math.sin(t) + 0.15) * Math.exp(-8 * (Math.sin(t) - 0.05) * (Math.sin(t) - 0.05));
    const chest = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t) + 0.2);
    const rump = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t) + 0.15);
    const r = 0.16 + 0.76 * earL + 0.76 * earR + 0.26 * head + 0.30 * tail + 0.16 * chest + 0.13 * rump;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function rabbitVerts(cx, cy, rx, ry) {
  const dense = rabbitRaw();
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

function sampleRabbit(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = rabbitVerts(cx, cy, rx, ry);
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

function rabbitHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleRabbit(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function squirrelRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const ear = Math.max(0, -Math.sin(t)) * Math.exp(-28 * (Math.cos(t) - 0.18) * (Math.cos(t) - 0.18));
    const snout = Math.max(0, Math.cos(t)) * Math.exp(-7 * (Math.sin(t) + 0.06) * (Math.sin(t) + 0.06));
    const tailUp = Math.max(0, -Math.sin(t)) * Math.max(0, -Math.cos(t) + 0.05) * Math.exp(-4.8 * (Math.cos(t) + 0.38) * (Math.cos(t) + 0.38));
    const tailBack = Math.max(0, -Math.cos(t)) * Math.max(0, -Math.sin(t) + 0.25) * Math.exp(-5.5 * (Math.sin(t) + 0.22) * (Math.sin(t) + 0.22));
    const chest = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t) + 0.2);
    const rump = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t) + 0.15);
    const r = 0.16 + 0.40 * ear + 0.38 * snout + 0.78 * tailUp + 0.42 * tailBack + 0.16 * chest + 0.13 * rump;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function squirrelVerts(cx, cy, rx, ry) {
  const dense = squirrelRaw();
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

function sampleSquirrel(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = squirrelVerts(cx, cy, rx, ry);
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

function squirrelHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleSquirrel(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function foxRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const earL = Math.max(0, -Math.sin(t)) * Math.exp(-30 * (Math.cos(t) + 0.16) * (Math.cos(t) + 0.16));
    const earR = Math.max(0, -Math.sin(t)) * Math.exp(-30 * (Math.cos(t) - 0.28) * (Math.cos(t) - 0.28));
    const snout = Math.max(0, Math.cos(t)) * Math.exp(-5.2 * (Math.sin(t) + 0.02) * (Math.sin(t) + 0.02));
    const tailHang = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t)) * Math.exp(-3.8 * (Math.cos(t) + 0.45) * (Math.cos(t) + 0.45));
    const tailBack = Math.max(0, -Math.cos(t)) * Math.max(0, Math.sin(t) + 0.12) * Math.exp(-6 * (Math.sin(t) - 0.22) * (Math.sin(t) - 0.22));
    const chest = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t) + 0.18);
    const r = 0.16 + 0.38 * earL + 0.38 * earR + 0.50 * snout + 0.76 * tailHang + 0.36 * tailBack + 0.15 * chest;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function foxVerts(cx, cy, rx, ry) {
  const dense = foxRaw();
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

function sampleFox(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = foxVerts(cx, cy, rx, ry);
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

function foxHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleFox(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function bearRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const earL = Math.max(0, -Math.sin(t)) * Math.exp(-18 * (Math.cos(t) + 0.18) * (Math.cos(t) + 0.18));
    const earR = Math.max(0, -Math.sin(t)) * Math.exp(-18 * (Math.cos(t) - 0.32) * (Math.cos(t) - 0.32));
    const snout = Math.max(0, Math.cos(t)) * Math.exp(-5.4 * (Math.sin(t) + 0.04) * (Math.sin(t) + 0.04));
    const legs = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t)) * Math.exp(-3.6 * (Math.cos(t) + 0.44) * (Math.cos(t) + 0.44));
    const back = Math.max(0, -Math.cos(t)) * Math.max(0, Math.sin(t) + 0.10) * Math.exp(-5.8 * (Math.sin(t) - 0.20) * (Math.sin(t) - 0.20));
    const chest = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t) + 0.18);
    const r = 0.16 + 0.40 * earL + 0.40 * earR + 0.46 * snout + 0.70 * legs + 0.32 * back + 0.14 * chest;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function bearVerts(cx, cy, rx, ry) {
  const dense = bearRaw();
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

function sampleBear(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = bearVerts(cx, cy, rx, ry);
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

function bearHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleBear(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function horseRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const earL = Math.max(0, -Math.sin(t)) * Math.exp(-26 * (Math.cos(t) - 0.18) * (Math.cos(t) - 0.18));
    const earR = Math.max(0, -Math.sin(t)) * Math.exp(-26 * (Math.cos(t) - 0.38) * (Math.cos(t) - 0.38));
    const muzzle = Math.max(0, Math.cos(t)) * Math.exp(-3.8 * (Math.sin(t) - 0.10) * (Math.sin(t) - 0.10));
    const mane = Math.max(0, -Math.sin(t)) * Math.max(0, -Math.cos(t) + 0.22) * Math.exp(-5.2 * (Math.cos(t) + 0.08) * (Math.cos(t) + 0.08));
    const legsF = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-3.4 * (Math.cos(t) - 0.30) * (Math.cos(t) - 0.30));
    const legsB = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t)) * Math.exp(-3.4 * (Math.cos(t) + 0.36) * (Math.cos(t) + 0.36));
    const tail = Math.max(0, -Math.cos(t)) * Math.max(0, Math.sin(t) + 0.08) * Math.exp(-5.6 * (Math.sin(t) - 0.28) * (Math.sin(t) - 0.28));
    const chest = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t) + 0.12);
    const r = 0.15 + 0.30 * earL + 0.30 * earR + 0.62 * muzzle + 0.34 * mane + 0.68 * legsF + 0.68 * legsB + 0.38 * tail + 0.13 * chest;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function horseVerts(cx, cy, rx, ry) {
  const dense = horseRaw();
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

function sampleHorse(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = horseVerts(cx, cy, rx, ry);
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

function horseHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleHorse(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function pigRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const earL = Math.max(0, -Math.sin(t)) * Math.exp(-24 * (Math.cos(t) + 0.22) * (Math.cos(t) + 0.22));
    const earR = Math.max(0, -Math.sin(t)) * Math.exp(-24 * (Math.cos(t) - 0.22) * (Math.cos(t) - 0.22));
    const snout = Math.max(0, Math.cos(t)) * Math.exp(-7.2 * (Math.sin(t) + 0.06) * (Math.sin(t) + 0.06));
    const belly = Math.max(0, Math.sin(t));
    const legsF = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-6.2 * (Math.cos(t) - 0.18) * (Math.cos(t) - 0.18));
    const legsB = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t)) * Math.exp(-6.2 * (Math.cos(t) + 0.24) * (Math.cos(t) + 0.24));
    const tail = Math.max(0, -Math.cos(t)) * Math.max(0, -Math.sin(t) + 0.12) * Math.exp(-9.4 * (Math.sin(t) + 0.22) * (Math.sin(t) + 0.22));
    const r = 0.22 + 0.38 * earL + 0.38 * earR + 0.44 * snout + 0.16 * belly + 0.40 * legsF + 0.40 * legsB + 0.30 * tail;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function pigVerts(cx, cy, rx, ry) {
  const dense = pigRaw();
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

function samplePig(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = pigVerts(cx, cy, rx, ry);
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

function pigHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = samplePig(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function cowRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const hornL = Math.max(0, -Math.sin(t)) * Math.exp(-18 * (Math.cos(t) + 0.40) * (Math.cos(t) + 0.40));
    const hornR = Math.max(0, -Math.sin(t)) * Math.exp(-18 * (Math.cos(t) - 0.40) * (Math.cos(t) - 0.40));
    const muzzle = Math.max(0, Math.cos(t)) * Math.exp(-4.6 * (Math.sin(t) - 0.02) * (Math.sin(t) - 0.02));
    const dewlap = Math.max(0, Math.cos(t)) * Math.max(0, Math.sin(t)) * Math.exp(-7.4 * (Math.sin(t) - 0.24) * (Math.sin(t) - 0.24));
    const body = Math.max(0, Math.sin(t));
    const udder = Math.max(0, Math.sin(t)) * Math.exp(-10 * (Math.cos(t) + 0.06) * (Math.cos(t) + 0.06));
    const legsF = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-4.8 * (Math.cos(t) - 0.30) * (Math.cos(t) - 0.30));
    const legsB = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t)) * Math.exp(-4.8 * (Math.cos(t) + 0.34) * (Math.cos(t) + 0.34));
    const tail = Math.max(0, -Math.cos(t)) * Math.max(0, Math.sin(t) + 0.16) * Math.exp(-6.4 * (Math.sin(t) - 0.22) * (Math.sin(t) - 0.22));
    const r = 0.16 + 0.50 * hornL + 0.50 * hornR + 0.58 * muzzle + 0.18 * dewlap + 0.20 * body + 0.30 * udder + 0.54 * legsF + 0.54 * legsB + 0.38 * tail;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function cowVerts(cx, cy, rx, ry) {
  const dense = cowRaw();
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

function sampleCow(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = cowVerts(cx, cy, rx, ry);
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

function cowHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleCow(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function sheepRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const woolA = Math.max(0, -Math.sin(t)) * Math.exp(-16 * (Math.cos(t) + 0.55) * (Math.cos(t) + 0.55));
    const woolB = Math.max(0, -Math.sin(t)) * Math.exp(-16 * (Math.cos(t) + 0.22) * (Math.cos(t) + 0.22));
    const woolC = Math.max(0, -Math.sin(t)) * Math.exp(-16 * (Math.cos(t) - 0.40) * (Math.cos(t) - 0.40));
    const head = Math.max(0, Math.cos(t)) * Math.exp(-4.2 * (Math.sin(t) - 0.28) * (Math.sin(t) - 0.28));
    const ear = Math.max(0, Math.cos(t)) * Math.max(0, -Math.sin(t)) * Math.exp(-12 * (Math.sin(t) + 0.06) * (Math.sin(t) + 0.06));
    const body = Math.max(0, Math.sin(t));
    const legsF = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-6.8 * (Math.cos(t) - 0.34) * (Math.cos(t) - 0.34));
    const legsB = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t)) * Math.exp(-6.8 * (Math.cos(t) + 0.40) * (Math.cos(t) + 0.40));
    const tail = Math.max(0, -Math.cos(t)) * Math.max(0, -Math.sin(t) + 0.06) * Math.exp(-10 * (Math.sin(t) + 0.24) * (Math.sin(t) + 0.24));
    const r = 0.20 + 0.34 * woolA + 0.36 * woolB + 0.34 * woolC + 0.62 * head + 0.18 * ear + 0.16 * body + 0.56 * legsF + 0.56 * legsB + 0.24 * tail;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function sheepVerts(cx, cy, rx, ry) {
  const dense = sheepRaw();
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

function sampleSheep(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = sheepVerts(cx, cy, rx, ry);
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

function sheepHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleSheep(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function goatRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const hornA = Math.max(0, -Math.sin(t)) * Math.exp(-16 * (Math.cos(t) - 0.40) * (Math.cos(t) - 0.40));
    const hornB = Math.max(0, -Math.sin(t)) * Math.exp(-16 * (Math.cos(t) + 0.34) * (Math.cos(t) + 0.34));
    const beard = Math.max(0, Math.cos(t)) * Math.max(0, Math.sin(t)) * Math.exp(-7.2 * (Math.sin(t) - 0.46) * (Math.sin(t) - 0.46));
    const muzzle = Math.max(0, Math.cos(t)) * Math.exp(-5.0 * (Math.sin(t) - 0.08) * (Math.sin(t) - 0.08));
    const ear = Math.max(0, Math.cos(t)) * Math.max(0, -Math.sin(t)) * Math.exp(-12 * (Math.sin(t) + 0.10) * (Math.sin(t) + 0.10));
    const body = Math.max(0, Math.sin(t));
    const legsF = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-6.8 * (Math.cos(t) - 0.32) * (Math.cos(t) - 0.32));
    const legsB = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t)) * Math.exp(-6.8 * (Math.cos(t) + 0.38) * (Math.cos(t) + 0.38));
    const tail = Math.max(0, -Math.cos(t)) * Math.max(0, -Math.sin(t) + 0.08) * Math.exp(-10 * (Math.sin(t) + 0.20) * (Math.sin(t) + 0.20));
    const r = 0.24 + 0.50 * hornA + 0.50 * hornB + 0.44 * beard + 0.46 * muzzle + 0.16 * ear + 0.24 * body + 0.50 * legsF + 0.50 * legsB + 0.22 * tail;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function goatVerts(cx, cy, rx, ry) {
  const dense = goatRaw();
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

function sampleGoat(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = goatVerts(cx, cy, rx, ry);
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

function goatHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleGoat(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function roosterRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const comb = Math.max(0, -Math.sin(t)) * Math.exp(-9.5 * (Math.cos(t) - 0.14) * (Math.cos(t) - 0.14));
    const beak = Math.max(0, Math.cos(t)) * Math.exp(-6.4 * (Math.sin(t) - 0.04) * (Math.sin(t) - 0.04));
    const wattle = Math.max(0, Math.cos(t)) * Math.max(0, Math.sin(t)) * Math.exp(-9.0 * (Math.sin(t) - 0.34) * (Math.sin(t) - 0.34));
    const tailA = Math.max(0, -Math.cos(t)) * Math.max(0, -Math.sin(t)) * Math.exp(-5.2 * (Math.sin(t) + 0.36) * (Math.sin(t) + 0.36));
    const tailB = Math.max(0, -Math.cos(t)) * Math.exp(-5.8 * (Math.sin(t) - 0.02) * (Math.sin(t) - 0.02));
    const tailC = Math.max(0, -Math.cos(t)) * Math.max(0, Math.sin(t)) * Math.exp(-6.4 * (Math.sin(t) - 0.30) * (Math.sin(t) - 0.30));
    const body = Math.max(0, Math.sin(t));
    const legsF = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-7.0 * (Math.cos(t) - 0.18) * (Math.cos(t) - 0.18));
    const legsB = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t) + 0.12) * Math.exp(-7.6 * (Math.cos(t) + 0.06) * (Math.cos(t) + 0.06));
    const r = 0.22 + 0.58 * comb + 0.50 * beak + 0.26 * wattle + 0.56 * tailA + 0.60 * tailB + 0.50 * tailC + 0.22 * body + 0.50 * legsF + 0.46 * legsB;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function roosterVerts(cx, cy, rx, ry) {
  const dense = roosterRaw();
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

function sampleRooster(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = roosterVerts(cx, cy, rx, ry);
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

function roosterHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleRooster(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function duckRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const bill = Math.max(0, Math.cos(t)) * Math.exp(-4.6 * (Math.sin(t) - 0.08) * (Math.sin(t) - 0.08));
    const head = Math.max(0, -Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-7.6 * (Math.cos(t) - 0.22) * (Math.cos(t) - 0.22));
    const breast = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-6.8 * (Math.cos(t) - 0.26) * (Math.cos(t) - 0.26));
    const tail = Math.max(0, -Math.cos(t)) * Math.exp(-7.8 * (Math.sin(t) + 0.10) * (Math.sin(t) + 0.10));
    const body = Math.max(0, Math.sin(t));
    const feetF = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-6.6 * (Math.cos(t) - 0.16) * (Math.cos(t) - 0.16));
    const feetB = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t) + 0.10) * Math.exp(-7.4 * (Math.cos(t) + 0.06) * (Math.cos(t) + 0.06));
    const r = 0.24 + 0.64 * bill + 0.40 * head + 0.18 * breast + 0.36 * tail + 0.26 * body + 0.42 * feetF + 0.38 * feetB;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function duckVerts(cx, cy, rx, ry) {
  const dense = duckRaw();
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

function sampleDuck(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = duckVerts(cx, cy, rx, ry);
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

function duckHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleDuck(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function gooseRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const bill = Math.max(0, Math.cos(t)) * Math.exp(-5.2 * (Math.sin(t) + 0.22) * (Math.sin(t) + 0.22));
    const neck = Math.max(0, -Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-4.4 * (Math.cos(t) - 0.06) * (Math.cos(t) - 0.06));
    const head = Math.max(0, -Math.sin(t)) * Math.exp(-8.6 * (Math.cos(t) - 0.10) * (Math.cos(t) - 0.10));
    const breast = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-7.2 * (Math.cos(t) - 0.22) * (Math.cos(t) - 0.22));
    const tail = Math.max(0, -Math.cos(t)) * Math.exp(-6.6 * (Math.sin(t) + 0.02) * (Math.sin(t) + 0.02));
    const body = Math.max(0, Math.sin(t));
    const feetF = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-6.8 * (Math.cos(t) - 0.14) * (Math.cos(t) - 0.14));
    const feetB = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t) + 0.10) * Math.exp(-7.6 * (Math.cos(t) + 0.06) * (Math.cos(t) + 0.06));
    const r = 0.20 + 0.54 * bill + 0.62 * neck + 0.50 * head + 0.14 * breast + 0.40 * tail + 0.22 * body + 0.38 * feetF + 0.34 * feetB;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function gooseVerts(cx, cy, rx, ry) {
  const dense = gooseRaw();
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

function sampleGoose(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = gooseVerts(cx, cy, rx, ry);
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

function gooseHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleGoose(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function turkeyRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const fanTop = Math.max(0, -Math.sin(t)) * Math.max(0, -Math.cos(t)) * Math.exp(-4.0 * (Math.cos(t) + 0.28) * (Math.cos(t) + 0.28));
    const fanMid = Math.max(0, -Math.cos(t)) * Math.exp(-3.4 * Math.sin(t) * Math.sin(t));
    const fanLow = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t)) * Math.exp(-4.4 * (Math.cos(t) + 0.22) * (Math.cos(t) + 0.22));
    const snood = Math.max(0, Math.cos(t)) * Math.max(0, Math.sin(t)) * Math.exp(-5.4 * (Math.sin(t) - 0.32) * (Math.sin(t) - 0.32));
    const head = Math.max(0, Math.cos(t)) * Math.exp(-7.2 * (Math.sin(t) + 0.06) * (Math.sin(t) + 0.06));
    const body = Math.max(0, Math.sin(t));
    const feetF = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-6.8 * (Math.cos(t) - 0.14) * (Math.cos(t) - 0.14));
    const feetB = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t) + 0.10) * Math.exp(-7.6 * (Math.cos(t) + 0.06) * (Math.cos(t) + 0.06));
    const r = 0.18 + 0.64 * fanTop + 0.70 * fanMid + 0.50 * fanLow + 0.46 * snood + 0.36 * head + 0.20 * body + 0.36 * feetF + 0.32 * feetB;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function turkeyVerts(cx, cy, rx, ry) {
  const dense = turkeyRaw();
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

function sampleTurkey(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = turkeyVerts(cx, cy, rx, ry);
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

function turkeyHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleTurkey(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function swanRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const bill = Math.max(0, Math.cos(t)) * Math.max(0, -Math.sin(t)) * Math.exp(-5.8 * (Math.sin(t) + 0.42) * (Math.sin(t) + 0.42));
    const head = Math.max(0, -Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-7.4 * (Math.cos(t) - 0.24) * (Math.cos(t) - 0.24));
    const neck = Math.max(0, -Math.sin(t)) * Math.exp(-6.2 * (Math.cos(t) - 0.04) * (Math.cos(t) - 0.04));
    const wingF = Math.max(0, -Math.sin(t)) * Math.max(0, Math.cos(t) + 0.12) * Math.exp(-4.8 * (Math.cos(t) - 0.16) * (Math.cos(t) - 0.16));
    const wingB = Math.max(0, -Math.sin(t)) * Math.max(0, -Math.cos(t)) * Math.exp(-4.6 * (Math.cos(t) + 0.22) * (Math.cos(t) + 0.22));
    const tail = Math.max(0, -Math.cos(t)) * Math.max(0, Math.sin(t) + 0.18) * Math.exp(-7.0 * (Math.sin(t) - 0.06) * (Math.sin(t) - 0.06));
    const body = Math.max(0, Math.sin(t));
    const feetF = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-6.8 * (Math.cos(t) - 0.14) * (Math.cos(t) - 0.14));
    const feetB = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t) + 0.10) * Math.exp(-7.6 * (Math.cos(t) + 0.06) * (Math.cos(t) + 0.06));
    const r = 0.18 + 0.52 * bill + 0.48 * head + 0.72 * neck + 0.44 * wingF + 0.50 * wingB + 0.30 * tail + 0.20 * body + 0.34 * feetF + 0.30 * feetB;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function swanVerts(cx, cy, rx, ry) {
  const dense = swanRaw();
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

function sampleSwan(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = swanVerts(cx, cy, rx, ry);
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

function swanHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = sampleSwan(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function peacockRaw() {
  const degs = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337];
  const corners = degs.map((d) => {
    const t = (d * Math.PI) / 180;
    const crest = Math.max(0, -Math.sin(t)) * Math.max(0, Math.cos(t) + 0.06) * Math.exp(-8.4 * (Math.cos(t) - 0.22) * (Math.cos(t) - 0.22));
    const head = Math.max(0, Math.cos(t)) * Math.max(0, -Math.sin(t) + 0.16) * Math.exp(-6.6 * (Math.sin(t) + 0.20) * (Math.sin(t) + 0.20));
    const neck = Math.max(0, Math.cos(t)) * Math.exp(-7.2 * (Math.sin(t) + 0.04) * (Math.sin(t) + 0.04));
    const trainTop = Math.max(0, -Math.sin(t)) * Math.max(0, -Math.cos(t) + 0.12) * Math.exp(-3.8 * (Math.cos(t) + 0.18) * (Math.cos(t) + 0.18));
    const trainMid = Math.max(0, -Math.cos(t)) * Math.exp(-3.4 * (Math.sin(t) + 0.14) * (Math.sin(t) + 0.14));
    const trainLow = Math.max(0, -Math.cos(t)) * Math.max(0, Math.sin(t) + 0.12) * Math.exp(-5.0 * (Math.sin(t) - 0.06) * (Math.sin(t) - 0.06));
    const body = Math.max(0, Math.sin(t));
    const feetF = Math.max(0, Math.sin(t)) * Math.max(0, Math.cos(t)) * Math.exp(-6.8 * (Math.cos(t) - 0.14) * (Math.cos(t) - 0.14));
    const feetB = Math.max(0, Math.sin(t)) * Math.max(0, -Math.cos(t) + 0.10) * Math.exp(-7.6 * (Math.cos(t) + 0.06) * (Math.cos(t) + 0.06));
    const r = 0.16 + 0.68 * crest + 0.40 * head + 0.26 * neck + 0.74 * trainTop + 0.70 * trainMid + 0.44 * trainLow + 0.18 * body + 0.34 * feetF + 0.30 * feetB;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  corners.push(corners[0]);
  const dense = [];
  for (let s = 0; s < corners.length - 1; s++) {
    const [x0, y0] = corners[s];
    const [x1, y1] = corners[s + 1];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      dense.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]);
    }
  }
  dense.push(corners[corners.length - 1]);
  return dense;
}

function peacockVerts(cx, cy, rx, ry) {
  const dense = peacockRaw();
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

function samplePeacock(lum, w, h, cx, cy, rx, ry) {
  if (rx < 8 || ry < 8) return new Float32Array(0);
  const verts = peacockVerts(cx, cy, rx, ry);
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

function peacockHoleCount(lum, w, h, cx, cy, rxMax, ryMax) {
  if (rxMax < 16 || ryMax < 16) return 0;
  const rMin = Math.min(rxMax, ryMax);
  const step = Math.max(2, Math.round(rMin * 0.06));
  let best = 0;
  for (let k = Math.max(16, Math.round(rMin * 0.55)); k <= rMin; k += step) {
    const t = k / rMin;
    const sig = samplePeacock(lum, w, h, cx, cy, rxMax * t, ryMax * t);
    const n = darkRegularHoles(sig);
    if (n < 12 || n <= best) continue;
    const win = 5;
    const hit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const perSide = sig.length / 16;
    for (let i = win; i < sig.length - win; i++) {
      const valley = sig[i];
      if (valley > 78) continue;
      if (Math.min(sig[i - win], sig[i + win]) - valley < 18) continue;
      hit[Math.floor(i / perSide) % 16]++;
      i += 4;
    }
    if (hit.filter((v) => v >= 1).length >= 10) best = n;
  }
  return best;
}

function ringHoleCount(lum, w, h, box) {
  const x0 = box ? Math.max(0, box.x0 | 0) : 0;
  const y0 = box ? Math.max(0, box.y0 | 0) : 0;
  const x1 = box ? Math.min(w, box.x1 | 0) : w;
  const y1 = box ? Math.min(h, box.y1 | 0) : h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rxMax = Math.min(cx - x0, x1 - cx);
  const ryMax = Math.min(cy - y0, y1 - cy);
  let best = Math.max(
    ellipseHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    diamondHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    hexagonHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    octagonHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    pentagonHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    triangleHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    starHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    heartHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    crescentHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    teardropHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    shieldHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    crossHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    arrowHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    cloudHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    cloverHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    flowerHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    butterflyHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    leafHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    fishHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    birdHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    catHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    dogHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    rabbitHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    squirrelHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    foxHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    bearHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    horseHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    pigHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    cowHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    sheepHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    goatHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    roosterHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    duckHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    gooseHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    turkeyHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    swanHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
    peacockHoleCount(lum, w, h, cx, cy, rxMax, ryMax),
  );
  if (Math.max(rxMax, ryMax) / Math.max(1, Math.min(rxMax, ryMax)) < 1.25) {
    for (const a of [1.35, 1.65, 2.0]) {
      const nWide = Math.max(
        ellipseHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        diamondHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        hexagonHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        octagonHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        pentagonHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        triangleHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        starHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        heartHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        crescentHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        teardropHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        shieldHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        crossHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        arrowHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        cloudHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        cloverHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        flowerHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        butterflyHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        leafHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        fishHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        birdHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        catHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        dogHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        rabbitHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        squirrelHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        foxHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        bearHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        horseHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        pigHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        cowHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        sheepHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        goatHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        roosterHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        duckHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        gooseHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        turkeyHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        swanHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
        peacockHoleCount(lum, w, h, cx, cy, rxMax, rxMax / a),
      );
      const nTall = Math.max(
        ellipseHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        diamondHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        hexagonHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        octagonHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        pentagonHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        triangleHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        starHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        heartHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        crescentHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        teardropHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        shieldHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        crossHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        arrowHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        cloudHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        cloverHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        flowerHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        butterflyHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        leafHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        fishHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        birdHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        catHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        dogHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        rabbitHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        squirrelHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        foxHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        bearHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        horseHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        pigHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        cowHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        sheepHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        goatHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        roosterHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        duckHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        gooseHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        turkeyHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        swanHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
        peacockHoleCount(lum, w, h, cx, cy, ryMax / a, ryMax),
      );
      if (nWide > best) best = nWide;
      if (nTall > best) best = nTall;
    }
  }
  return best;
}

function looksLikeRoundStamp(n) {
  return n >= 12;
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
  let looksStamp = looksLikeStamp(peaks) || looksLikeRoundStamp(ringHoleCount(lum, w, h));
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
      if (!looksLikeStamp(edgePeakHint(lum, w, h, search)) && !looksLikeRoundStamp(ringHoleCount(lum, w, h, search))) continue;
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
    singleRoundGlass(image, interiorMid.rounds, w, h, border) ||
    multiRoundGlass(image, interiorTint.rounds, w, h, border) ||
    multiRoundGlass(image, interiorMid.rounds, w, h, border);

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
