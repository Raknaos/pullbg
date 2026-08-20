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

function borderStats(lum, w, h) {
  let n = 0;
  let dark = 0;
  let white = 0;
  let sum = 0;
  const add = (x, y) => {
    const v = lum[y * w + x];
    n++;
    sum += v;
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
  return { darkFrac: dark / n, whiteFrac: white / n, mean: sum / n, n };
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
          [cx - 1, cy - 1],
          [cx + 1, cy - 1],
          [cx - 1, cy + 1],
          [cx + 1, cy + 1],
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
      const bbox = (x1 - x0 + 1) * (y1 - y0 + 1);
      const fill = bbox > 0 ? area / bbox : 0;
      const pane = fill >= 0.72 && area >= minPane;
      if (fill >= 0.88 && area >= minPane) rectangular++;
      if (!pane && area < minArea) continue;
      total += area;
      count++;
      if (area > largest) largest = area;
    }
  }
  return { largest: largest / n, total: total / n, count, rectangular };
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
  return peaks.stampedSides >= 2 && peaks.total >= 40;
}

export function classifyImage(image) {
  const { width: w, height: h } = image;
  const lum = lumaMap(image);
  const border = borderStats(lum, w, h);
  const paneBlack = Math.max(14, Math.min(50, border.mean - 8));
  const paneWhite = Math.min(248, Math.max(234, border.mean + 40));
  const interiorBlack = interiorMass(lum, w, h, (v) => v <= paneBlack, 0.025);
  const interiorWhite = interiorMass(lum, w, h, (v) => v >= paneWhite, 0.025);
  const interiorMid = interiorMass(
    lum,
    w,
    h,
    (v) => v > paneBlack && v < paneWhite && Math.abs(v - border.mean) >= 24,
    0.025,
  );
  const peaks = edgePeakHint(lum, w, h);
  let looksStamp = looksLikeStamp(peaks);
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
      if (looksLikeStamp(edgePeakHint(lum, w, h, search))) {
        looksStamp = true;
        break;
      }
    }
  }
  const closedBlack = interiorBlack.largest >= 0.12 || interiorBlack.total >= 0.16;
  const closedWhite = interiorWhite.largest >= 0.12 || interiorWhite.total >= 0.16;
  const multiPane =
    (interiorBlack.rectangular >= 2 && interiorBlack.total >= 0.1) ||
    (interiorMid.rectangular >= 2 && interiorMid.total >= 0.08);

  if (looksStamp && border.darkFrac >= 0.25) {
    return { kind: "timbre photo", mode: "timbre", interior: false, reason: "fond sombre + dentelé" };
  }
  if (looksStamp) {
    return { kind: "timbre scan", mode: "timbre", interior: false, reason: `dentelé (${peaks.stampedSides} bords, ${peaks.total} trous)` };
  }
  if ((closedBlack && border.darkFrac >= 0.15) || multiPane) {
    return { kind: "fenêtre / écran", mode: "noir", interior: true, reason: "grand rectangle noir fermé (lecteur, UI)" };
  }
  if (closedWhite && border.whiteFrac < 0.55) {
    return { kind: "fenêtre / page", mode: "aucun", interior: true, reason: "grande page blanche fermée dans un cadre" };
  }
  if (border.darkFrac >= 0.42 && border.mean < 75) {
    return { kind: "objet sur fond noir", mode: "noir", interior: false, reason: "bords très sombres" };
  }
  if (border.whiteFrac >= 0.45) {
    return { kind: "objet / produit", mode: "ia", interior: false, reason: "fond clair, IA générale" };
  }
  return { kind: "général", mode: "ia", interior: false, reason: "pas de motif spécial, IA par défaut" };
}
