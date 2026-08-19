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
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  let largest = 0;
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const s = y * w + x;
      if (!pred(lum[s]) || seen[s]) continue;
      let head = 0;
      let tail = 0;
      let area = 0;
      let border = false;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
      seen[s] = 1;
      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        area++;
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
      if (border || area < minArea) continue;
      total += area;
      if (area > largest) largest = area;
    }
  }
  return { largest: largest / n, total: total / n };
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

function edgePeakHint(lum, w, h) {
  const strip = Math.max(8, Math.round(Math.min(w, h) * 0.04));
  const top = new Float32Array(w);
  const bot = new Float32Array(w);
  const left = new Float32Array(h);
  const right = new Float32Array(h);
  top.fill(1e9);
  bot.fill(1e9);
  left.fill(1e9);
  right.fill(1e9);
  for (let y = 0; y < strip; y++) {
    for (let x = 0; x < w; x++) if (lum[y * w + x] < top[x]) top[x] = lum[y * w + x];
  }
  for (let y = h - strip; y < h; y++) {
    for (let x = 0; x < w; x++) if (lum[y * w + x] < bot[x]) bot[x] = lum[y * w + x];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < strip; x++) if (lum[y * w + x] < left[y]) left[y] = lum[y * w + x];
    for (let x = w - strip; x < w; x++) if (lum[y * w + x] < right[y]) right[y] = lum[y * w + x];
  }
  const sides = [darkRegularHoles(top), darkRegularHoles(bot), darkRegularHoles(left), darkRegularHoles(right)];
  return {
    sides,
    total: sides.reduce((a, b) => a + b, 0),
    stampedSides: sides.filter((n) => n >= 8).length,
  };
}

export function classifyImage(image) {
  const { width: w, height: h } = image;
  const lum = lumaMap(image);
  const border = borderStats(lum, w, h);
  const paneBlack = Math.max(14, Math.min(22, border.mean - 6));
  const paneWhite = Math.min(248, Math.max(234, border.mean + 40));
  const interiorBlack = interiorMass(lum, w, h, (v) => v <= paneBlack, 0.025);
  const interiorWhite = interiorMass(lum, w, h, (v) => v >= paneWhite, 0.025);
  const peaks = edgePeakHint(lum, w, h);
  const looksStamp = peaks.stampedSides >= 2 && peaks.total >= 40;
  const closedBlack = interiorBlack.largest >= 0.12 || interiorBlack.total >= 0.16;
  const closedWhite = interiorWhite.largest >= 0.12 || interiorWhite.total >= 0.16;

  if (closedBlack && border.darkFrac >= 0.15) {
    return { kind: "fenêtre / écran", mode: "noir", interior: true, reason: "grand rectangle noir fermé (lecteur, UI)" };
  }
  if (closedWhite && border.whiteFrac < 0.55) {
    return { kind: "fenêtre / page", mode: "aucun", interior: true, reason: "grande page blanche fermée dans un cadre" };
  }
  if (looksStamp && border.darkFrac >= 0.25) {
    return { kind: "timbre photo", mode: "timbre", interior: false, reason: "fond sombre + dentelé" };
  }
  if (looksStamp) {
    return { kind: "timbre scan", mode: "timbre", interior: false, reason: `dentelé (${peaks.stampedSides} bords, ${peaks.total} trous)` };
  }
  if (border.darkFrac >= 0.42 && border.mean < 75) {
    return { kind: "objet sur fond noir", mode: "noir", interior: false, reason: "bords très sombres" };
  }
  if (border.whiteFrac >= 0.45) {
    return { kind: "objet / produit", mode: "ia", interior: false, reason: "fond clair, IA générale" };
  }
  return { kind: "général", mode: "ia", interior: false, reason: "pas de motif spécial, IA par défaut" };
}
