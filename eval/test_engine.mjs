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
const { fastCut, chooseRefinedResult } = await import("../lib/engine.js");

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

function fillCircle(image, cx, cy, r, rr, gg, bb) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function fillEllipse(image, cx, cy, rx, ry, rr, gg, bb) {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function fillDiamond(image, cx, cy, rx, ry, rr, gg, bb) {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const nx = Math.abs(x - cx) / rx;
      const ny = Math.abs(y - cy) / ry;
      if (nx + ny > 1) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function fillHexagon(image, cx, cy, rx, ry, flat, rr, gg, bb) {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const ax = Math.abs(x - cx) / rx;
      const ay = Math.abs(y - cy) / ry;
      const e = flat ? Math.max(ax, ay, ax + ay * 0.5) : Math.max(ax, ay, ax * 0.5 + ay);
      if (e > 1) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function fillOctagon(image, cx, cy, rx, ry, rr, gg, bb) {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const ax = Math.abs(x - cx) / rx;
      const ay = Math.abs(y - cy) / ry;
      if (Math.max(ax, ay, (ax + ay) / Math.SQRT2) > 1) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
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

function fillPentagon(image, cx, cy, rx, ry, rr, gg, bb) {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      if (pentNorm(x - cx, y - cy, rx, ry) > 1) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function fillTriangle(image, cx, y0, y1, half, rr, gg, bb) {
  for (let y = y0; y <= y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0);
    const span = Math.round(half * t);
    for (let x = cx - span; x <= cx + span; x++) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function fillTrapezoid(image, cx, y0, y1, topHalf, botHalf, rr, gg, bb) {
  for (let y = y0; y <= y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0);
    const span = Math.round(topHalf + (botHalf - topHalf) * t);
    for (let x = cx - span; x <= cx + span; x++) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function fillStar(image, cx, cy, ro, ri, rr, gg, bb) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rad = i % 2 === 0 ? ro : ri;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
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

function fillHeart(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = heartVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
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

function fillCrescent(image, cx, cy, rx, ry, rr, gg, bb, inner = 0.72, shift = 0.4, dir = 0) {
  const x0 = Math.max(0, Math.floor(cx - rx - 1));
  const x1 = Math.min(image.width - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1));
  const y1 = Math.min(image.height - 1, Math.ceil(cy + ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inCrescent(x, y, cx, cy, rx, ry, inner, shift, dir)) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
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

function fillTeardrop(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = teardropVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
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

function fillShield(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = shieldVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
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

function inCross(x, y, cx, cy, rx, ry, arm = 0.35) {
  const nx = (x - cx) / rx;
  const ny = (y - cy) / ry;
  return (Math.abs(nx) <= arm && Math.abs(ny) <= 1) || (Math.abs(ny) <= arm && Math.abs(nx) <= 1);
}

function fillCross(image, cx, cy, rx, ry, rr, gg, bb) {
  const x0 = Math.max(0, Math.floor(cx - rx - 1));
  const x1 = Math.min(image.width - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1));
  const y1 = Math.min(image.height - 1, Math.ceil(cy + ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inCross(x, y, cx, cy, rx, ry)) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
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

function inArrow(x, y, cx, cy, rx, ry, shaft = 0.32, neck = -0.2) {
  const nx = (x - cx) / rx;
  const ny = (y - cy) / ry;
  if (ny < -1 || ny > 1) return false;
  if (ny >= neck) return Math.abs(nx) <= shaft;
  const t = (ny + 1) / (neck + 1);
  return Math.abs(nx) <= t;
}

function fillArrow(image, cx, cy, rx, ry, rr, gg, bb) {
  const x0 = Math.max(0, Math.floor(cx - rx - 1));
  const x1 = Math.min(image.width - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1));
  const y1 = Math.min(image.height - 1, Math.ceil(cy + ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inArrow(x, y, cx, cy, rx, ry)) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
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

function fillCloud(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = cloudVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
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

function fillClover(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = cloverVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
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

function fillFlower(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = flowerVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
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

function fillButterfly(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = butterflyVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function fillQuatrefoil(image, cx, cy, r, rr, gg, bb) {
  const off = Math.round(r * 0.86);
  fillCircle(image, cx, cy - off, r, rr, gg, bb);
  fillCircle(image, cx, cy + off, r, rr, gg, bb);
  fillCircle(image, cx - off, cy, r, rr, gg, bb);
  fillCircle(image, cx + off, cy, r, rr, gg, bb);
}

function fillSemi(image, cx, cy, rx, ry, rr, gg, bb) {
  for (let y = cy - ry; y <= cy; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
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

function mixedDayNightWindow() {
  const img = rgb(80, 80, 48, 42, 36);
  fillRect(img, 6, 6, 36, 36, 8, 8, 8);
  fillRect(img, 44, 6, 74, 36, 92, 168, 220);
  fillRect(img, 6, 44, 36, 74, 10, 10, 10);
  fillRect(img, 44, 44, 74, 74, 90, 164, 218);
  return img;
}

{
  const img = mixedDayNightWindow();
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `mixed day/night window classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[20 * 80 + 20] < 16, "mixed dark top-left pane punched");
  assert(a[20 * 80 + 60] < 16, "mixed sky top-right pane punched");
  assert(a[60 * 80 + 20] < 16, "mixed dark bottom-left pane punched");
  assert(a[60 * 80 + 60] < 16, "mixed sky bottom-right pane punched");
  assert(a[2 * 80 + 2] > 180, "mixed-window outer frame kept");
  assert(a[40 * 80 + 40] > 180, "mixed-window mullion kept");
  assert(cut.pipeline === "écran", "mixed window uses screen pipeline");
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

{
  const img = rgb(180, 100, 255, 255, 255);
  fillCircle(img, 52, 50, 25, 8, 8, 8);
  fillCircle(img, 128, 50, 25, 8, 8, 8);
  const guess = classifyImage(img);
  assert(!guess.interior, `two round pupils are not panes (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[50 * 180 + 52] > 180, "left pupil kept");
  assert(a[50 * 180 + 128] > 180, "right pupil kept");
  assert(cut.needsRefine === true, "round pupils use IA route, not pane punch");
}

{
  const img = rgb(80, 80, 22, 22, 22);
  fillRect(img, 8, 8, 38, 38, 6, 6, 6);
  fillRect(img, 38, 38, 68, 68, 6, 6, 6);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `corner-touch panes classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[20 * 80 + 20] < 16, "top-left corner-touch pane punched");
  assert(a[50 * 80 + 50] < 16, "bottom-right corner-touch pane punched");
  assert(a[2 * 80 + 2] > 180, "corner-touch frame kept");
}

{
  const img = rgb(160, 100, 255, 255, 255);
  fillRect(img, 18, 14, 142, 86, 225, 225, 225);
  fillRect(img, 30, 24, 70, 76, 255, 70, 180);
  fillRect(img, 90, 24, 130, 76, 255, 70, 180);
  const guess = classifyImage(img);
  assert(guess.mode === "couleur", `flat pink graphic uses color route (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[50 * 160 + 50] > 180, "flat pink graphic kept");
  assert(a[50 * 160 + 80] < 16, "neutral support inside graphic removed");
  assert(a[2 * 160 + 2] < 16, "white background removed");
  assert(cut.needsRefine === false && cut.pipeline === "couleur", "flat color skips IA");
}

function foliageWindow() {
  const img = rgb(80, 80, 120, 80, 50);
  fillRect(img, 6, 6, 36, 36, 40, 120, 45);
  fillRect(img, 44, 6, 74, 36, 36, 128, 40);
  fillRect(img, 6, 44, 36, 74, 44, 110, 50);
  fillRect(img, 44, 44, 74, 74, 38, 118, 48);
  return img;
}

{
  const img = foliageWindow();
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood/foliage window classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[20 * 80 + 20] < 16, "foliage top-left pane punched");
  assert(a[20 * 80 + 60] < 16, "foliage top-right pane punched");
  assert(a[60 * 80 + 20] < 16, "foliage bottom-left pane punched");
  assert(a[60 * 80 + 60] < 16, "foliage bottom-right pane punched");
  assert(a[2 * 80 + 2] > 180, "wood-window outer frame kept");
  assert(a[40 * 80 + 40] > 180, "wood-window mullion kept");
  assert(cut.pipeline === "écran", "wood/foliage window uses screen pipeline");
}

{
  const img = rgb(160, 100, 8, 8, 8);
  fillCircle(img, 50, 50, 22, 255, 70, 180);
  fillCircle(img, 110, 50, 22, 40, 200, 80);
  const guess = classifyImage(img);
  assert(!guess.interior, `two round products on black are not panes (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[50 * 160 + 50] > 180, "left round product on black kept");
  assert(a[50 * 160 + 110] > 180, "right round product on black kept");
  assert(a[2 * 160 + 2] < 16, "black studio around round products gone");
  assert(cut.needsRefine === false, "round products on black stay on geometry");
}

{
  const img = rgb(180, 100, 255, 255, 255);
  fillRect(img, 20, 25, 60, 75, 240, 30, 30);
  fillRect(img, 70, 25, 110, 75, 30, 220, 50);
  fillRect(img, 120, 25, 160, 75, 30, 70, 230);
  const guess = classifyImage(img);
  assert(guess.mode === "ia", `multicolor product stays on IA route (${guess.kind})`);
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillRect(img, 30, 30, 90, 90, 255, 70, 180);
  const draft = fastCut(img);
  const opaqueModel = { image: img, name: "ia", score: { score: 0.05, tr: 0, br: 0, ck: 1 } };
  const final = chooseRefinedResult(draft, opaqueModel);
  assert(final.pipeline === draft.pipeline, "opaque IA result falls back to draft");
  assert(alphaOf(final.image)[0] < 16, "opaque IA cannot restore white background");
}

function whiteFrameWindow() {
  const img = rgb(80, 80, 255, 255, 255);
  fillRect(img, 6, 6, 36, 36, 8, 8, 8);
  fillRect(img, 44, 6, 74, 36, 8, 8, 8);
  fillRect(img, 6, 44, 36, 74, 8, 8, 8);
  fillRect(img, 44, 44, 74, 74, 8, 8, 8);
  return img;
}

{
  const img = whiteFrameWindow();
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `white PVC frame window classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[20 * 80 + 20] < 16, "white-frame top-left pane punched");
  assert(a[20 * 80 + 60] < 16, "white-frame top-right pane punched");
  assert(a[60 * 80 + 20] < 16, "white-frame bottom-left pane punched");
  assert(a[60 * 80 + 60] < 16, "white-frame bottom-right pane punched");
  assert(a[2 * 80 + 2] > 180, "white PVC outer frame kept");
  assert(a[40 * 80 + 40] > 180, "white PVC mullion kept");
  assert(cut.pipeline === "écran", "white-frame window uses screen pipeline");
}

function whiteSkyWindow() {
  const img = rgb(80, 80, 255, 255, 255);
  fillRect(img, 6, 6, 36, 36, 92, 168, 220);
  fillRect(img, 44, 6, 74, 36, 88, 160, 214);
  fillRect(img, 6, 44, 36, 74, 96, 172, 224);
  fillRect(img, 44, 44, 74, 74, 90, 164, 218);
  return img;
}

{
  const img = whiteSkyWindow();
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `white PVC sky window classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[20 * 80 + 20] < 16, "white-frame sky top-left pane punched");
  assert(a[20 * 80 + 60] < 16, "white-frame sky top-right pane punched");
  assert(a[60 * 80 + 20] < 16, "white-frame sky bottom-left pane punched");
  assert(a[60 * 80 + 60] < 16, "white-frame sky bottom-right pane punched");
  assert(a[2 * 80 + 2] > 180, "white PVC sky outer frame kept");
  assert(a[40 * 80 + 40] > 180, "white PVC sky mullion kept");
  assert(cut.pipeline === "écran", "white-frame sky window uses screen pipeline");
}

{
  const img = rgb(80, 80, 255, 255, 255);
  fillRect(img, 8, 10, 36, 70, 92, 168, 220);
  fillRect(img, 44, 10, 72, 70, 88, 160, 214);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `white PVC 2-pane sky classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 22] < 16, "white-frame left sky pane punched");
  assert(a[40 * 80 + 58] < 16, "white-frame right sky pane punched");
  assert(a[2 * 80 + 2] > 180, "white PVC 2-pane outer frame kept");
  assert(a[40 * 80 + 40] > 180, "white PVC 2-pane mullion kept");
}

function whiteDarkCasement() {
  const img = rgb(80, 80, 255, 255, 255);
  fillRect(img, 8, 10, 36, 70, 8, 8, 8);
  fillRect(img, 44, 10, 72, 70, 8, 8, 8);
  return img;
}

{
  const img = whiteDarkCasement();
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `white PVC 2-pane dark classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 22] < 16, "white-frame left dark pane punched");
  assert(a[40 * 80 + 58] < 16, "white-frame right dark pane punched");
  assert(a[2 * 80 + 2] > 180, "white PVC 2-pane dark outer frame kept");
  assert(a[40 * 80 + 40] > 180, "white PVC 2-pane dark mullion kept");
  assert(cut.pipeline === "écran", "white-frame 2-pane dark uses screen pipeline");
}

{
  const img = rgb(80, 80, 255, 255, 255);
  fillRect(img, 8, 10, 36, 70, 8, 8, 8);
  fillRect(img, 44, 10, 72, 70, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `white PVC mixed 2-pane classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 22] < 16, "white-frame mixed dark pane punched");
  assert(a[40 * 80 + 58] < 16, "white-frame mixed sky pane punched");
  assert(a[2 * 80 + 2] > 180, "white PVC mixed 2-pane outer frame kept");
  assert(a[40 * 80 + 40] > 180, "white PVC mixed 2-pane mullion kept");
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillRect(img, 30, 30, 90, 90, 8, 8, 8);
  const guess = classifyImage(img);
  assert(guess.mode === "ia", `single dark product on white stays on IA (${guess.kind})`);
}

{
  const img = rgb(180, 100, 255, 255, 255);
  fillRect(img, 20, 20, 80, 80, 8, 8, 8);
  fillRect(img, 100, 20, 160, 80, 8, 8, 8);
  const guess = classifyImage(img);
  assert(guess.mode === "ia", `two dark products on white stay on IA (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[50 * 180 + 50] > 180, "left dark product kept (not punched as a pane)");
  assert(a[50 * 180 + 130] > 180, "right dark product kept (not punched as a pane)");
  assert(cut.needsRefine === true, "two dark products on white use IA, not pane punch");
}

{
  const img = rgb(180, 100, 255, 255, 255);
  fillRect(img, 20, 20, 80, 80, 200, 30, 30);
  fillRect(img, 100, 20, 160, 80, 200, 30, 30);
  const guess = classifyImage(img);
  assert(guess.mode === "ia" || guess.mode === "couleur", `two red products on white stay off window route (${guess.kind})`);
  assert(!guess.interior, `two red products are not panes (${guess.kind})`);
}

function whiteBlownSkyWindow() {
  const img = rgb(80, 80, 255, 255, 255);
  fillRect(img, 6, 6, 36, 36, 236, 242, 250);
  fillRect(img, 44, 6, 74, 36, 234, 240, 248);
  fillRect(img, 6, 44, 36, 74, 238, 244, 252);
  fillRect(img, 44, 44, 74, 74, 235, 241, 249);
  return img;
}

{
  const img = whiteBlownSkyWindow();
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `white PVC blown-out sky classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[20 * 80 + 20] < 16, "blown-out top-left pane punched");
  assert(a[20 * 80 + 60] < 16, "blown-out top-right pane punched");
  assert(a[60 * 80 + 20] < 16, "blown-out bottom-left pane punched");
  assert(a[60 * 80 + 60] < 16, "blown-out bottom-right pane punched");
  assert(a[2 * 80 + 2] > 180, "white PVC blown-out outer frame kept");
  assert(a[40 * 80 + 40] > 180, "white PVC blown-out mullion kept");
  assert(cut.pipeline === "écran", "white PVC blown-out sky uses screen pipeline");
}

{
  const img = rgb(80, 80, 255, 255, 255);
  fillRect(img, 8, 10, 36, 70, 236, 242, 250);
  fillRect(img, 44, 10, 72, 70, 234, 240, 248);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `white PVC 2-pane blown-out sky classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 22] < 16, "blown-out left pane punched");
  assert(a[40 * 80 + 58] < 16, "blown-out right pane punched");
  assert(a[2 * 80 + 2] > 180, "white PVC 2-pane blown-out outer frame kept");
  assert(a[40 * 80 + 40] > 180, "white PVC 2-pane blown-out mullion kept");
}

{
  const img = rgb(180, 100, 255, 255, 255);
  fillRect(img, 20, 20, 80, 80, 240, 240, 240);
  fillRect(img, 100, 20, 160, 80, 242, 242, 242);
  const guess = classifyImage(img);
  assert(!guess.interior, `two pale-gray products are not panes (${guess.kind})`);
  assert(guess.mode === "ia" || guess.mode === "couleur", `two pale-gray products stay off window route (${guess.kind})`);
}

function coilStamp() {
  const img = rgb(160, 160, 180, 150, 90);
  const punch = (x, y) => fillRect(img, x - 1, y - 1, x + 2, y + 2, 8, 8, 8);
  for (let i = 12; i <= 148; i += 8) {
    punch(i, 1);
    punch(i, 158);
  }
  return img;
}

{
  const img = coilStamp();
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `coil stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[80 * 160 + 80] > 180, "coil stamp body kept whole");
  assert(a[1 * 160 + 12] < 16, "coil top perforation punched");
  assert(a[158 * 160 + 12] < 16, "coil bottom perforation punched");
  assert(cut.pipeline === "timbre", "coil stamp uses stamp pipeline");
}

{
  const img = rgb(160, 160, 180, 150, 90);
  const punch = (x, y) => fillRect(img, x - 1, y - 1, x + 2, y + 2, 8, 8, 8);
  for (let i = 12; i <= 148; i += 8) {
    punch(1, i);
    punch(158, i);
  }
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `booklet stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[80 * 160 + 80] > 180, "booklet stamp body kept whole");
  assert(a[12 * 160 + 1] < 16, "booklet left perforation punched");
  assert(cut.pipeline === "timbre", "booklet stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillRect(img, 70, 70, 130, 130, 40, 90, 160);
  const punch = (x, y) => fillRect(img, x - 1, y - 1, x + 2, y + 2, 8, 8, 8);
  for (let i = 50; i <= 150; i += 8) {
    punch(i, 50);
    punch(i, 150);
  }
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `inset coil classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[100 * 200 + 100] > 180, "inset coil design kept");
  assert(a[60 * 200 + 100] > 180, "inset coil paper margin kept (whole piece)");
  assert(a[50 * 200 + 90] < 16, "inset coil perforations punched");
  assert(a[8 * 200 + 8] < 16, "album paper around inset coil gone");
  assert(cut.pipeline === "timbre", "inset coil uses stamp pipeline");
}

{
  const img = rgb(160, 160, 255, 255, 255);
  fillRect(img, 30, 30, 130, 130, 200, 40, 40);
  const punch = (x, y) => fillRect(img, x - 1, y - 1, x + 2, y + 2, 8, 8, 8);
  for (let i = 10; i <= 150; i += 8) {
    punch(i, 2);
    punch(i, 157);
  }
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `studio edge dots are not a stamp (${guess.kind})`);
}

{
  const img = rgb(120, 80, 0, 180, 60);
  fillRect(img, 35, 15, 85, 65, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode === "fond", `green screen classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "green-screen subject kept");
  assert(a[2 * 120 + 2] < 16, "green screen flooded");
  assert(cut.pipeline === "fond", "green screen uses color flood");
  assert(cut.needsRefine === false, "green screen skips IA when flood works");
}

{
  const img = rgb(120, 80, 10, 40, 180);
  fillRect(img, 35, 15, 85, 65, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode === "fond", `blue screen classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "blue-screen subject kept");
  assert(a[2 * 120 + 2] < 16, "blue screen flooded");
  assert(cut.pipeline === "fond", "blue screen uses color flood, not failed black flood");
  assert(cut.needsRefine === false, "blue screen skips IA when flood works");
}

{
  const img = rgb(120, 80, 180, 180, 180);
  fillRect(img, 40, 20, 80, 60, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode === "fond", `gray seamless classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "gray-studio subject kept");
  assert(a[2 * 120 + 2] < 16, "gray seamless flooded");
}

{
  const img = rgb(120, 80, 180, 20, 20);
  fillRect(img, 35, 15, 85, 65, 240, 240, 240);
  const guess = classifyImage(img);
  assert(!guess.interior, `white product on red is not a page (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "white product on red kept");
  assert(a[2 * 120 + 2] < 16, "red studio around white product gone");
}

{
  const img = rgb(80, 80, 20, 80, 180);
  const guess = classifyImage(img);
  assert(guess.mode === "ia", `full-frame ocean stays on IA (${guess.kind})`);
}

{
  const img = rgb(120, 80, 210, 210, 210);
  for (let y = 0; y < 80; y++) {
    const v = Math.round(210 - (y / 79) * 72);
    fillRect(img, 0, y, 120, y + 1, v, v, v);
  }
  fillRect(img, 38, 16, 84, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode === "fond", `cyclorama gradient classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[36 * 120 + 60] > 180, "gradient-studio subject kept");
  assert(a[2 * 120 + 2] < 16, "light top of cyclorama flooded");
  assert(a[78 * 120 + 8] < 16, "dark floor of cyclorama flooded");
  assert(cut.pipeline === "fond", "cyclorama uses color flood, not a single border mean");
  assert(cut.needsRefine === false, "working cyclorama flood skips IA");
}

{
  const img = rgb(120, 80, 0, 180, 60);
  fillRect(img, 40, 48, 82, 80, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode === "fond", `product on studio floor classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[64 * 120 + 60] > 180, "product sitting on the floor kept");
  assert(a[79 * 120 + 60] > 180, "product pixels touching the bottom edge kept");
  assert(a[2 * 120 + 2] < 16, "green screen around floor product gone");
}

{
  const img = rgb(160, 100, 0, 180, 60);
  fillRect(img, 0, 0, 90, 75, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode === "fond", `product covering one corner classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 160 + 40] > 180, "corner-covering product kept");
  assert(a[2 * 160 + 150] < 16, "green opposite the covered corner flooded");
  assert(a[98 * 160 + 8] < 16, "green below the covered corner flooded");
}

{
  const img = rgb(80, 80, 48, 42, 36);
  fillRect(img, 12, 12, 68, 68, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `single sky pane classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "single sky pane punched");
  assert(a[2 * 80 + 2] > 180, "single-sky frame kept");
  assert(cut.pipeline === "écran", "single sky pane uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillRect(img, 12, 12, 68, 68, 40, 120, 45);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `single foliage pane classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "single foliage pane punched");
  assert(a[2 * 80 + 2] > 180, "wood frame around foliage kept");
  assert(cut.pipeline === "écran", "single foliage pane uses screen pipeline");
}

{
  const img = rgb(80, 80, 255, 255, 255);
  fillRect(img, 12, 12, 68, 68, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `white PVC single sky classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "white PVC single sky pane punched");
  assert(a[2 * 80 + 2] > 180, "white PVC single-pane frame kept");
  assert(cut.pipeline === "écran", "white PVC single sky uses screen pipeline");
}

{
  const img = rgb(80, 80, 48, 42, 36);
  fillRect(img, 18, 36, 62, 70, 92, 168, 220);
  fillCircle(img, 40, 36, 22, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `arched sky window classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[50 * 80 + 40] < 16, "arched window body punched");
  assert(a[24 * 80 + 40] < 16, "arched window crown punched");
  assert(a[2 * 80 + 2] > 180, "arched window frame kept");
  assert(cut.pipeline === "écran", "arched window uses screen pipeline");
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillRect(img, 30, 30, 90, 90, 80, 160, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `blue product on white is not a pane (${guess.kind})`);
  assert(guess.mode === "ia" || guess.mode === "couleur", `blue product on white stays off window route (${guess.kind})`);
}

{
  const img = rgb(120, 80, 8, 8, 8);
  fillRect(img, 40, 10, 80, 70, 80, 180, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `cyan bottle on black is not a pane (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "cyan bottle on black kept");
  assert(a[2 * 120 + 2] < 16, "black studio around cyan bottle gone");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillCircle(img, 40, 40, 26, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `round sky oeil-de-boeuf classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "round sky pane punched");
  assert(a[2 * 80 + 2] > 180, "round-window wood frame kept");
  assert(a[14 * 80 + 14] > 180, "round-window corner frame kept");
  assert(cut.pipeline === "écran", "round sky window uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillCircle(img, 40, 40, 26, 40, 120, 45);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `round foliage oeil-de-boeuf classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "round foliage pane punched");
  assert(a[2 * 80 + 2] > 180, "round foliage wood frame kept");
  assert(cut.pipeline === "écran", "round foliage window uses screen pipeline");
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillCircle(img, 60, 60, 40, 80, 160, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `round blue product on white is not a pane (${guess.kind})`);
  assert(guess.mode === "ia" || guess.mode === "couleur", `round blue product on white stays off window route (${guess.kind})`);
}

{
  const img = rgb(120, 80, 8, 8, 8);
  fillCircle(img, 60, 40, 26, 80, 180, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `round blue product on black is not a pane (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "round blue product on black kept");
  assert(a[2 * 120 + 2] < 16, "black studio around round blue product gone");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillEllipse(img, 40, 40, 32, 20, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `oval sky oeil-de-boeuf classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "oval sky pane punched");
  assert(a[2 * 80 + 2] > 180, "oval-window wood frame kept");
  assert(a[14 * 80 + 14] > 180, "oval-window corner frame kept");
  assert(cut.pipeline === "écran", "oval sky window uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillEllipse(img, 40, 40, 20, 32, 40, 120, 45);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `oval foliage oeil-de-boeuf classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "oval foliage pane punched");
  assert(a[2 * 80 + 2] > 180, "oval foliage wood frame kept");
  assert(cut.pipeline === "écran", "oval foliage window uses screen pipeline");
}

{
  const img = rgb(80, 100, 48, 42, 36);
  fillRect(img, 18, 40, 62, 90, 92, 168, 220);
  for (let y = 10; y < 40; y++) {
    const half = Math.round(22 * ((y - 10) / 30));
    fillRect(img, 40 - half, y, 40 + half, y + 1, 92, 168, 220);
  }
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `gothic sky window classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 80 + 40] < 16, "gothic window body punched");
  assert(a[20 * 80 + 40] < 16, "gothic window crown punched");
  assert(a[2 * 80 + 2] > 180, "gothic window frame kept");
  assert(cut.pipeline === "écran", "gothic window uses screen pipeline");
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillEllipse(img, 60, 60, 48, 28, 80, 160, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `oval blue product on white is not a pane (${guess.kind})`);
  assert(guess.mode === "ia" || guess.mode === "couleur", `oval blue product on white stays off window route (${guess.kind})`);
}

{
  const img = rgb(120, 80, 8, 8, 8);
  fillEllipse(img, 60, 40, 22, 32, 80, 180, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `oval blue product on black is not a pane (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "oval blue product on black kept");
  assert(a[2 * 120 + 2] < 16, "black studio around oval blue product gone");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillSemi(img, 40, 48, 32, 32, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `sky fanlight classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[32 * 80 + 40] < 16, "sky fanlight pane punched");
  assert(a[2 * 80 + 2] > 180, "sky fanlight frame kept");
  assert(a[70 * 80 + 40] > 180, "sky fanlight sill kept");
  assert(cut.pipeline === "écran", "sky fanlight uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillSemi(img, 40, 48, 32, 32, 40, 120, 45);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `foliage fanlight classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[32 * 80 + 40] < 16, "foliage fanlight pane punched");
  assert(a[2 * 80 + 2] > 180, "foliage fanlight frame kept");
  assert(cut.pipeline === "écran", "foliage fanlight uses screen pipeline");
}

{
  const img = rgb(80, 50, 120, 80, 50);
  fillSemi(img, 40, 36, 30, 24, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wide sky fanlight classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[24 * 80 + 40] < 16, "wide fanlight pane punched");
  assert(a[2 * 80 + 2] > 180, "wide fanlight frame kept");
  assert(cut.pipeline === "écran", "wide fanlight uses screen pipeline");
}

{
  const img = rgb(120, 80, 8, 8, 8);
  fillSemi(img, 60, 50, 28, 28, 80, 180, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `semicircle product on black is not a pane (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "semicircle product on black kept");
  assert(a[2 * 120 + 2] < 16, "black studio around semicircle product gone");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillRect(img, 12, 12, 68, 68, 8, 8, 8);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood night pane classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood night pane punched");
  assert(a[2 * 80 + 2] > 180, "wood night frame kept");
  assert(cut.pipeline === "écran", "wood night pane uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillCircle(img, 40, 40, 26, 8, 8, 8);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood night oeil-de-boeuf classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood night round pane punched");
  assert(a[2 * 80 + 2] > 180, "wood night round frame kept");
  assert(a[14 * 80 + 14] > 180, "wood night round corner frame kept");
  assert(cut.pipeline === "écran", "wood night round uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillSemi(img, 40, 48, 32, 32, 8, 8, 8);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood night fanlight classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[32 * 80 + 40] < 16, "wood night fanlight pane punched");
  assert(a[2 * 80 + 2] > 180, "wood night fanlight frame kept");
  assert(a[70 * 80 + 40] > 180, "wood night fanlight sill kept");
  assert(cut.pipeline === "écran", "wood night fanlight uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillEllipse(img, 40, 40, 32, 20, 8, 8, 8);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood night oval classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood night oval pane punched");
  assert(a[2 * 80 + 2] > 180, "wood night oval frame kept");
  assert(cut.pipeline === "écran", "wood night oval uses screen pipeline");
}

{
  const img = rgb(120, 80, 180, 180, 180);
  fillRect(img, 40, 20, 80, 60, 8, 8, 8);
  const guess = classifyImage(img);
  assert(!guess.interior, `dark product on gray studio is not a pane (${guess.kind})`);
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillRect(img, 12, 12, 68, 68, 210, 140, 50);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood warm pane classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood warm pane punched");
  assert(a[2 * 80 + 2] > 180, "wood warm frame kept");
  assert(cut.pipeline === "écran", "wood warm pane uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillCircle(img, 40, 40, 26, 210, 140, 50);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood warm oeil-de-boeuf classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood warm round pane punched");
  assert(a[2 * 80 + 2] > 180, "wood warm round frame kept");
  assert(a[14 * 80 + 14] > 180, "wood warm round corner frame kept");
  assert(cut.pipeline === "écran", "wood warm round uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillEllipse(img, 40, 40, 32, 20, 210, 140, 50);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood warm oval classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood warm oval pane punched");
  assert(a[2 * 80 + 2] > 180, "wood warm oval frame kept");
  assert(cut.pipeline === "écran", "wood warm oval uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillSemi(img, 40, 48, 32, 32, 210, 140, 50);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood warm fanlight classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[32 * 80 + 40] < 16, "wood warm fanlight pane punched");
  assert(a[2 * 80 + 2] > 180, "wood warm fanlight frame kept");
  assert(a[70 * 80 + 40] > 180, "wood warm fanlight sill kept");
  assert(cut.pipeline === "écran", "wood warm fanlight uses screen pipeline");
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillRect(img, 30, 30, 90, 90, 210, 140, 50);
  const guess = classifyImage(img);
  assert(!guess.interior, `orange product on white is not a pane (${guess.kind})`);
}

{
  const img = rgb(120, 80, 8, 8, 8);
  fillRect(img, 40, 10, 80, 70, 210, 140, 50);
  const guess = classifyImage(img);
  assert(!guess.interior, `orange product on black is not a pane (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "orange product on black kept");
  assert(a[2 * 120 + 2] < 16, "black studio around orange product gone");
}

{
  const img = rgb(120, 80, 180, 180, 180);
  fillRect(img, 40, 20, 80, 60, 210, 140, 50);
  const guess = classifyImage(img);
  assert(!guess.interior, `orange product on gray studio is not a pane (${guess.kind})`);
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillRect(img, 12, 12, 68, 68, 162, 168, 174);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood overcast pane classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood overcast pane punched");
  assert(a[2 * 80 + 2] > 180, "wood overcast frame kept");
  assert(cut.pipeline === "écran", "wood overcast pane uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillCircle(img, 40, 40, 26, 162, 168, 174);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood overcast oeil-de-boeuf classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood overcast round pane punched");
  assert(a[2 * 80 + 2] > 180, "wood overcast round frame kept");
  assert(a[14 * 80 + 14] > 180, "wood overcast round corner frame kept");
  assert(cut.pipeline === "écran", "wood overcast round uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillEllipse(img, 40, 40, 32, 20, 162, 168, 174);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood overcast oval classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood overcast oval pane punched");
  assert(a[2 * 80 + 2] > 180, "wood overcast oval frame kept");
  assert(cut.pipeline === "écran", "wood overcast oval uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillSemi(img, 40, 48, 32, 32, 162, 168, 174);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood overcast fanlight classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[32 * 80 + 40] < 16, "wood overcast fanlight pane punched");
  assert(a[2 * 80 + 2] > 180, "wood overcast fanlight frame kept");
  assert(a[70 * 80 + 40] > 180, "wood overcast fanlight sill kept");
  assert(cut.pipeline === "écran", "wood overcast fanlight uses screen pipeline");
}

{
  const img = rgb(80, 80, 255, 255, 255);
  fillRect(img, 12, 12, 68, 68, 162, 168, 174);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `white PVC overcast pane classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "white PVC overcast pane punched");
  assert(a[2 * 80 + 2] > 180, "white PVC overcast frame kept");
  assert(cut.pipeline === "écran", "white PVC overcast uses screen pipeline");
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillRect(img, 30, 30, 90, 90, 162, 168, 174);
  const guess = classifyImage(img);
  assert(!guess.interior, `cool-gray product on white is not a pane (${guess.kind})`);
}

{
  const img = rgb(120, 80, 8, 8, 8);
  fillRect(img, 40, 10, 80, 70, 162, 168, 174);
  const guess = classifyImage(img);
  assert(!guess.interior, `cool-gray product on black is not a pane (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "cool-gray product on black kept");
  assert(a[2 * 120 + 2] < 16, "black studio around cool-gray product gone");
}

{
  const img = rgb(120, 80, 180, 180, 180);
  fillRect(img, 40, 20, 80, 60, 162, 168, 174);
  const guess = classifyImage(img);
  assert(!guess.interior, `cool-gray product on gray studio is not a pane (${guess.kind})`);
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillDiamond(img, 40, 40, 28, 28, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood lozenge sky classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood lozenge sky pane punched");
  assert(a[2 * 80 + 2] > 180, "wood lozenge sky frame kept");
  assert(a[12 * 80 + 12] > 180, "wood lozenge sky corner frame kept");
  assert(cut.pipeline === "écran", "wood lozenge sky uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillDiamond(img, 40, 40, 28, 28, 40, 120, 45);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood lozenge foliage classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood lozenge foliage pane punched");
  assert(a[2 * 80 + 2] > 180, "wood lozenge foliage frame kept");
  assert(cut.pipeline === "écran", "wood lozenge foliage uses screen pipeline");
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillDiamond(img, 60, 60, 40, 40, 80, 160, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `lozenge blue product on white is not a pane (${guess.kind})`);
}

{
  const img = rgb(120, 80, 8, 8, 8);
  fillDiamond(img, 60, 40, 28, 28, 80, 180, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `lozenge blue product on black is not a pane (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "lozenge product on black kept");
  assert(a[2 * 120 + 2] < 16, "black studio around lozenge product gone");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillTriangle(img, 40, 12, 68, 26, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood gable sky classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[50 * 80 + 40] < 16, "wood gable sky pane punched");
  assert(a[2 * 80 + 2] > 180, "wood gable sky frame kept");
  assert(a[72 * 80 + 40] > 180, "wood gable sky sill kept");
  assert(cut.pipeline === "écran", "wood gable sky uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillTriangle(img, 40, 12, 68, 26, 40, 120, 45);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood gable foliage classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[50 * 80 + 40] < 16, "wood gable foliage pane punched");
  assert(a[2 * 80 + 2] > 180, "wood gable foliage frame kept");
  assert(cut.pipeline === "écran", "wood gable foliage uses screen pipeline");
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillTriangle(img, 60, 20, 100, 40, 80, 160, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `triangle blue product on white is not a pane (${guess.kind})`);
}

{
  const img = rgb(120, 80, 8, 8, 8);
  fillTriangle(img, 60, 10, 70, 28, 80, 180, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `triangle blue product on black is not a pane (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[50 * 120 + 60] > 180, "triangle product on black kept");
  assert(a[2 * 120 + 2] < 16, "black studio around triangle product gone");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillQuatrefoil(img, 40, 40, 14, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood quatrefoil sky classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood quatrefoil sky pane punched");
  assert(a[2 * 80 + 2] > 180, "wood quatrefoil sky frame kept");
  assert(a[12 * 80 + 12] > 180, "wood quatrefoil sky corner frame kept");
  assert(cut.pipeline === "écran", "wood quatrefoil sky uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillQuatrefoil(img, 40, 40, 14, 40, 120, 45);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood quatrefoil foliage classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood quatrefoil foliage pane punched");
  assert(a[2 * 80 + 2] > 180, "wood quatrefoil foliage frame kept");
  assert(cut.pipeline === "écran", "wood quatrefoil foliage uses screen pipeline");
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillQuatrefoil(img, 60, 60, 20, 80, 160, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `quatrefoil blue product on white is not a pane (${guess.kind})`);
}

{
  const img = rgb(120, 80, 8, 8, 8);
  fillQuatrefoil(img, 60, 40, 14, 80, 180, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `quatrefoil blue product on black is not a pane (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "quatrefoil product on black kept");
  assert(a[2 * 120 + 2] < 16, "black studio around quatrefoil product gone");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillTrapezoid(img, 40, 16, 64, 8, 26, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood trapezoid sky classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[50 * 80 + 40] < 16, "wood trapezoid sky pane punched");
  assert(a[2 * 80 + 2] > 180, "wood trapezoid sky frame kept");
  assert(a[70 * 80 + 40] > 180, "wood trapezoid sky sill kept");
  assert(cut.pipeline === "écran", "wood trapezoid sky uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillTrapezoid(img, 40, 16, 64, 8, 26, 40, 120, 45);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood trapezoid foliage classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[50 * 80 + 40] < 16, "wood trapezoid foliage pane punched");
  assert(a[2 * 80 + 2] > 180, "wood trapezoid foliage frame kept");
  assert(cut.pipeline === "écran", "wood trapezoid foliage uses screen pipeline");
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillTrapezoid(img, 60, 24, 96, 16, 40, 80, 160, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `trapezoid blue product on white is not a pane (${guess.kind})`);
}

{
  const img = rgb(120, 80, 8, 8, 8);
  fillTrapezoid(img, 60, 12, 68, 10, 28, 80, 180, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `trapezoid blue product on black is not a pane (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[50 * 120 + 60] > 180, "trapezoid product on black kept");
  assert(a[2 * 120 + 2] < 16, "black studio around trapezoid product gone");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillStar(img, 40, 40, 28, 12, 92, 168, 220);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood star sky classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood star sky pane punched");
  assert(a[2 * 80 + 2] > 180, "wood star sky frame kept");
  assert(a[12 * 80 + 12] > 180, "wood star sky corner frame kept");
  assert(cut.pipeline === "écran", "wood star sky uses screen pipeline");
}

{
  const img = rgb(80, 80, 120, 80, 50);
  fillStar(img, 40, 40, 28, 12, 40, 120, 45);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood star foliage classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 80 + 40] < 16, "wood star foliage pane punched");
  assert(a[2 * 80 + 2] > 180, "wood star foliage frame kept");
  assert(cut.pipeline === "écran", "wood star foliage uses screen pipeline");
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillStar(img, 60, 60, 40, 16, 80, 160, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `star blue product on white is not a pane (${guess.kind})`);
}

{
  const img = rgb(120, 80, 8, 8, 8);
  fillStar(img, 60, 40, 28, 12, 80, 180, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `star blue product on black is not a pane (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "star product on black kept");
  assert(a[2 * 120 + 2] < 16, "black studio around star product gone");
}

function leadedLattice(sky) {
  const img = rgb(160, 160, 120, 80, 50);
  fillDiamond(img, 48, 48, 24, 24, ...sky);
  fillDiamond(img, 112, 48, 24, 24, sky[0] - 4, sky[1] - 8, sky[2] - 6);
  fillDiamond(img, 48, 112, 24, 24, sky[0] + 4, sky[1] + 4, sky[2] + 4);
  fillDiamond(img, 112, 112, 24, 24, sky[0] - 2, sky[1] - 4, sky[2] - 2);
  return img;
}

{
  const img = leadedLattice([92, 168, 220]);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood leaded sky lattice classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[48 * 160 + 48] < 16, "wood leaded sky top-left punched");
  assert(a[48 * 160 + 112] < 16, "wood leaded sky top-right punched");
  assert(a[112 * 160 + 48] < 16, "wood leaded sky bottom-left punched");
  assert(a[112 * 160 + 112] < 16, "wood leaded sky bottom-right punched");
  assert(a[2 * 160 + 2] > 180, "wood leaded sky outer frame kept");
  assert(a[80 * 160 + 80] > 180, "wood leaded sky mullion kept");
  assert(cut.pipeline === "écran", "wood leaded sky uses screen pipeline");
}

{
  const img = leadedLattice([40, 120, 45]);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood leaded foliage lattice classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[48 * 160 + 48] < 16, "wood leaded foliage top-left punched");
  assert(a[112 * 160 + 112] < 16, "wood leaded foliage bottom-right punched");
  assert(a[2 * 160 + 2] > 180, "wood leaded foliage outer frame kept");
  assert(a[80 * 160 + 80] > 180, "wood leaded foliage mullion kept");
  assert(cut.pipeline === "écran", "wood leaded foliage uses screen pipeline");
}

{
  const img = rgb(160, 120, 255, 255, 255);
  fillDiamond(img, 48, 60, 28, 28, 80, 160, 220);
  fillDiamond(img, 112, 60, 28, 28, 80, 160, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `two lozenge products on white are not a lattice (${guess.kind})`);
}

{
  const img = rgb(160, 80, 8, 8, 8);
  fillDiamond(img, 48, 40, 22, 22, 80, 180, 220);
  fillDiamond(img, 112, 40, 22, 22, 80, 180, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `two lozenge products on black are not a lattice (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 160 + 48] > 180, "left lozenge product on black kept");
  assert(a[40 * 160 + 112] > 180, "right lozenge product on black kept");
  assert(a[2 * 160 + 2] < 16, "black studio around two lozenge products gone");
}

function bullseye(sky) {
  const img = rgb(80, 80, 120, 80, 50);
  fillCircle(img, 40, 40, 26, ...sky);
  fillCircle(img, 40, 40, 10, 120, 80, 50);
  return img;
}

{
  const img = bullseye([92, 168, 220]);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood bullseye sky classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[22 * 80 + 40] < 16, "wood bullseye sky ring punched");
  assert(a[40 * 80 + 40] > 180, "wood bullseye sky boss kept");
  assert(a[2 * 80 + 2] > 180, "wood bullseye sky frame kept");
  assert(cut.pipeline === "écran", "wood bullseye sky uses screen pipeline");
}

{
  const img = bullseye([40, 120, 45]);
  const guess = classifyImage(img);
  assert(guess.interior && guess.mode === "noir", `wood bullseye foliage classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[22 * 80 + 40] < 16, "wood bullseye foliage ring punched");
  assert(a[40 * 80 + 40] > 180, "wood bullseye foliage boss kept");
  assert(a[2 * 80 + 2] > 180, "wood bullseye foliage frame kept");
  assert(cut.pipeline === "écran", "wood bullseye foliage uses screen pipeline");
}

{
  const img = rgb(120, 120, 255, 255, 255);
  fillCircle(img, 60, 60, 36, 80, 160, 220);
  fillCircle(img, 60, 60, 16, 255, 255, 255);
  const guess = classifyImage(img);
  assert(!guess.interior, `ring product on white is not a pane (${guess.kind})`);
}

{
  const img = rgb(120, 80, 8, 8, 8);
  fillCircle(img, 60, 40, 28, 80, 180, 220);
  fillCircle(img, 60, 40, 16, 8, 8, 8);
  fillCircle(img, 60, 40, 7, 80, 180, 220);
  const guess = classifyImage(img);
  assert(!guess.interior, `concentric product on black is not a pane (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[40 * 120 + 60] > 180, "concentric product center kept");
  assert(a[40 * 120 + 82] > 180, "concentric product ring kept");
  assert(a[2 * 120 + 2] < 16, "black studio around concentric product gone");
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillCircle(img, 100, 100, 48, 40, 90, 160);
  for (let i = 0; i < 36; i++) {
    const t = (i / 36) * Math.PI * 2;
    fillCircle(img, Math.round(100 + Math.cos(t) * 58), Math.round(100 + Math.sin(t) * 58), 2, 8, 8, 8);
  }
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `round stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[100 * 200 + 100] > 180, "round stamp design kept");
  assert(a[100 * 200 + 154] > 180, "round stamp paper margin kept (whole piece)");
  assert(a[100 * 200 + 158] < 16, "round stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around round stamp gone");
  assert(cut.pipeline === "timbre", "round stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillCircle(img, 100, 100, 48, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `round product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillCircle(img, 100, 60, 40, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `round product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "round product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around round product gone");
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillEllipse(img, 100, 100, 70, 42, 40, 90, 160);
  for (let i = 0; i < 36; i++) {
    const t = (i / 36) * Math.PI * 2;
    fillCircle(img, Math.round(100 + Math.cos(t) * 80), Math.round(100 + Math.sin(t) * 52), 2, 8, 8, 8);
  }
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `oval stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[100 * 200 + 100] > 180, "oval stamp design kept");
  assert(a[100 * 200 + 174] > 180, "oval stamp paper margin kept (whole piece)");
  assert(a[100 * 200 + 180] < 16, "oval stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around oval stamp gone");
  assert(cut.pipeline === "timbre", "oval stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillEllipse(img, 100, 100, 70, 42, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `oval product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillEllipse(img, 100, 60, 56, 34, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `oval product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "oval product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around oval product gone");
}

function punchDiamond(img, cx, cy, rx, ry) {
  const verts = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
  for (let s = 0; s < 4; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 4];
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.5) / 9;
      fillCircle(img, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 2, 8, 8, 8);
    }
  }
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillDiamond(img, 100, 100, 56, 40, 40, 90, 160);
  punchDiamond(img, 100, 100, 80, 60);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `diamond stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[100 * 200 + 100] > 180, "diamond stamp design kept");
  assert(a[100 * 200 + 166] > 180, "diamond stamp paper margin kept (whole piece)");
  assert(a[56 * 200 + 100] > 180, "diamond stamp vertical margin kept (whole piece)");
  assert(a[100 * 200 + 180] < 16, "diamond stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around diamond stamp gone");
  assert(cut.pipeline === "timbre", "diamond stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillDiamond(img, 100, 100, 70, 42, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `diamond product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillDiamond(img, 100, 60, 56, 34, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `diamond product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "diamond product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around diamond product gone");
}

function punchHexagon(img, cx, cy, rx, ry, flat) {
  const verts = flat
    ? [[cx + rx, cy], [cx + rx * 0.5, cy + ry], [cx - rx * 0.5, cy + ry], [cx - rx, cy], [cx - rx * 0.5, cy - ry], [cx + rx * 0.5, cy - ry]]
    : [[cx, cy - ry], [cx + rx, cy - ry * 0.5], [cx + rx, cy + ry * 0.5], [cx, cy + ry], [cx - rx, cy + ry * 0.5], [cx - rx, cy - ry * 0.5]];
  for (let s = 0; s < 6; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 6];
    for (let i = 0; i < 8; i++) {
      const t = (i + 0.5) / 8;
      fillCircle(img, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 2, 8, 8, 8);
    }
  }
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillHexagon(img, 100, 100, 48, 56, false, 40, 90, 160);
  punchHexagon(img, 100, 100, 70, 80, false);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `hexagon stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[100 * 200 + 100] > 180, "hexagon stamp design kept");
  assert(a[100 * 200 + 160] > 180, "hexagon stamp paper margin kept (whole piece)");
  assert(a[36 * 200 + 100] > 180, "hexagon stamp vertical margin kept (whole piece)");
  assert(a[100 * 200 + 170] < 16, "hexagon stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around hexagon stamp gone");
  assert(cut.pipeline === "timbre", "hexagon stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillHexagon(img, 100, 100, 70, 42, false, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `hexagon product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillHexagon(img, 100, 60, 56, 34, false, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `hexagon product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "hexagon product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around hexagon product gone");
}

function punchOctagon(img, cx, cy, rx, ry) {
  const k = Math.SQRT2 - 1;
  const verts = [
    [cx + rx, cy - ry * k],
    [cx + rx, cy + ry * k],
    [cx + rx * k, cy + ry],
    [cx - rx * k, cy + ry],
    [cx - rx, cy + ry * k],
    [cx - rx, cy - ry * k],
    [cx - rx * k, cy - ry],
    [cx + rx * k, cy - ry],
  ];
  for (let s = 0; s < 8; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 8];
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      fillCircle(img, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 2, 8, 8, 8);
    }
  }
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillOctagon(img, 100, 100, 48, 48, 40, 90, 160);
  punchOctagon(img, 100, 100, 70, 70);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `octagon stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[100 * 200 + 100] > 180, "octagon stamp design kept");
  assert(a[100 * 200 + 160] > 180, "octagon stamp paper margin kept (whole piece)");
  assert(a[40 * 200 + 100] > 180, "octagon stamp vertical margin kept (whole piece)");
  assert(a[128 * 200 + 168] > 180, "octagon stamp chamfer margin kept (whole piece)");
  assert(a[76 * 200 + 170] < 16, "octagon stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around octagon stamp gone");
  assert(cut.pipeline === "timbre", "octagon stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillOctagon(img, 100, 100, 70, 42, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `octagon product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillOctagon(img, 100, 60, 56, 34, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `octagon product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "octagon product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around octagon product gone");
}

function punchPentagon(img, cx, cy, rx, ry) {
  const verts = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    verts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  for (let s = 0; s < 5; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 5];
    for (let i = 0; i < 7; i++) {
      const t = (i + 0.5) / 7;
      fillCircle(img, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 2, 8, 8, 8);
    }
  }
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillPentagon(img, 100, 100, 48, 48, 40, 90, 160);
  punchPentagon(img, 100, 100, 70, 70);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `pentagon stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[100 * 200 + 100] > 180, "pentagon stamp design kept");
  assert(a[42 * 200 + 100] > 180, "pentagon stamp paper margin kept (whole piece)");
  assert(a[82 * 200 + 155] > 180, "pentagon stamp diagonal margin kept (whole piece)");
  assert(a[54 * 200 + 133] < 16, "pentagon stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around pentagon stamp gone");
  assert(cut.pipeline === "timbre", "pentagon stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillPentagon(img, 100, 100, 70, 42, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `pentagon product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillPentagon(img, 100, 60, 56, 34, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `pentagon product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "pentagon product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around pentagon product gone");
}

function punchTriangle(img, cx, cy, rx, ry, flip) {
  const verts = flip
    ? [[cx, cy + ry], [cx + rx, cy - ry], [cx - rx, cy - ry]]
    : [[cx, cy - ry], [cx - rx, cy + ry], [cx + rx, cy + ry]];
  for (let s = 0; s < 3; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 3];
    for (let i = 0; i < 7; i++) {
      const t = (i + 0.5) / 7;
      fillCircle(img, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 2, 8, 8, 8);
    }
  }
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillTriangle(img, 100, 52, 148, 48, 40, 90, 160);
  punchTriangle(img, 100, 100, 70, 70, false);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `triangle stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[100 * 200 + 100] > 180, "triangle stamp design kept");
  assert(a[48 * 200 + 100] > 180, "triangle stamp paper margin kept (whole piece)");
  assert(a[158 * 200 + 100] > 180, "triangle stamp base margin kept (whole piece)");
  assert(a[170 * 200 + 100] < 16, "triangle stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around triangle stamp gone");
  assert(cut.pipeline === "timbre", "triangle stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillTriangle(img, 100, 58, 142, 70, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `triangle product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillTriangle(img, 100, 26, 94, 56, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `triangle product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "triangle product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around triangle product gone");
}

function punchStar(img, cx, cy, ro, ri) {
  const verts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? ro : ri;
    verts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  for (let s = 0; s < 10; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 10];
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      fillCircle(img, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 2, 8, 8, 8);
    }
  }
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillStar(img, 100, 100, 48, 20, 40, 90, 160);
  punchStar(img, 100, 100, 70, 30);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `star stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[100 * 200 + 100] > 180, "star stamp design kept");
  assert(a[44 * 200 + 100] > 180, "star stamp paper margin kept (whole piece)");
  assert(a[36 * 200 + 102] < 16, "star stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around star stamp gone");
  assert(cut.pipeline === "timbre", "star stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillStar(img, 100, 100, 70, 28, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `star product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillStar(img, 100, 60, 48, 20, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `star product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "star product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around star product gone");
}

function punchHeart(img, cx, cy, rx, ry) {
  const verts = heartVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillHeart(img, 100, 100, 40, 42, 40, 90, 160);
  const holes = punchHeart(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `heart stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = heartVerts(100, 100, 70, 74);
  let top = large[0];
  for (const v of large) if (v[1] < top[1]) top = v;
  const mx = Math.round(100 + (top[0] - 100) * 0.72);
  const my = Math.round(100 + (top[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "heart stamp design kept");
  assert(a[my * 200 + mx] > 180, "heart stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "heart stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around heart stamp gone");
  assert(cut.pipeline === "timbre", "heart stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillHeart(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `heart product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillHeart(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `heart product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "heart product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around heart product gone");
}

function punchCrescent(img, cx, cy, rx, ry, inner = 0.72, shift = 0.4, dir = 0) {
  const verts = crescentVerts(cx, cy, rx, ry, inner, shift, dir);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillCrescent(img, 100, 100, 40, 42, 40, 90, 160);
  const holes = punchCrescent(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `crescent stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const mx = Math.round(100 - 70 * 0.72);
  const my = 100;
  assert(a[100 * 200 + 70] > 180, "crescent stamp design kept");
  assert(a[my * 200 + mx] > 180, "crescent stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "crescent stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around crescent stamp gone");
  assert(cut.pipeline === "timbre", "crescent stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillCrescent(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `crescent product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillCrescent(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `crescent product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 70] > 180, "crescent product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around crescent product gone");
}

function punchTeardrop(img, cx, cy, rx, ry) {
  const verts = teardropVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillTeardrop(img, 100, 100, 40, 42, 40, 90, 160);
  const holes = punchTeardrop(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `teardrop stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = teardropVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[1] < tip[1]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "teardrop stamp design kept");
  assert(a[my * 200 + mx] > 180, "teardrop stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "teardrop stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around teardrop stamp gone");
  assert(cut.pipeline === "timbre", "teardrop stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillTeardrop(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `teardrop product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillTeardrop(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `teardrop product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "teardrop product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around teardrop product gone");
}

function punchShield(img, cx, cy, rx, ry) {
  const verts = shieldVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillShield(img, 100, 100, 40, 42, 40, 90, 160);
  const holes = punchShield(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `shield stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = shieldVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[1] > tip[1]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "shield stamp design kept");
  assert(a[my * 200 + mx] > 180, "shield stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "shield stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around shield stamp gone");
  assert(cut.pipeline === "timbre", "shield stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillShield(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `shield product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillShield(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `shield product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "shield product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around shield product gone");
}

function punchCross(img, cx, cy, rx, ry) {
  const verts = crossVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillCross(img, 100, 100, 40, 42, 40, 90, 160);
  const holes = punchCross(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `cross stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const mx = 100;
  const my = Math.round(100 - 74 * 0.72);
  assert(a[100 * 200 + 100] > 180, "cross stamp design kept");
  assert(a[my * 200 + mx] > 180, "cross stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "cross stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around cross stamp gone");
  assert(a[52 * 200 + 148] < 16, "cross stamp notch not filled");
  assert(cut.pipeline === "timbre", "cross stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillCross(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `cross product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillCross(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `cross product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "cross product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around cross product gone");
}

function punchArrow(img, cx, cy, rx, ry) {
  const verts = arrowVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillArrow(img, 100, 100, 40, 42, 40, 90, 160);
  const holes = punchArrow(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `arrow stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const mx = 100;
  const my = Math.round(100 - 74 * 0.72);
  assert(a[100 * 200 + 100] > 180, "arrow stamp design kept");
  assert(a[my * 200 + mx] > 180, "arrow stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "arrow stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around arrow stamp gone");
  assert(a[130 * 200 + 148] < 16, "arrow stamp notch not filled");
  assert(cut.pipeline === "timbre", "arrow stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillArrow(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `arrow product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillArrow(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `arrow product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "arrow product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around arrow product gone");
}

function punchCloud(img, cx, cy, rx, ry) {
  const verts = cloudVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillCloud(img, 100, 100, 40, 42, 40, 90, 160);
  const holes = punchCloud(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `cloud stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = cloudVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[1] < tip[1]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "cloud stamp design kept");
  assert(a[my * 200 + mx] > 180, "cloud stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "cloud stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around cloud stamp gone");
  assert(a[32 * 200 + 36] < 16, "cloud stamp notch not filled");
  assert(cut.pipeline === "timbre", "cloud stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillCloud(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `cloud product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillCloud(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `cloud product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "cloud product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around cloud product gone");
}

function punchClover(img, cx, cy, rx, ry) {
  const verts = cloverVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillClover(img, 100, 100, 40, 42, 40, 90, 160);
  const holes = punchClover(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `clover stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = cloverVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[0] > tip[0]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "clover stamp design kept");
  assert(a[my * 200 + mx] > 180, "clover stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "clover stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around clover stamp gone");
  assert(a[100 * 200 + 40] < 16, "clover stamp notch not filled");
  assert(cut.pipeline === "timbre", "clover stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillClover(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `clover product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillClover(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `clover product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "clover product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around clover product gone");
}

function punchFlower(img, cx, cy, rx, ry) {
  const verts = flowerVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillFlower(img, 100, 100, 40, 42, 40, 90, 160);
  const holes = punchFlower(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `flower stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = flowerVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[0] > tip[0]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "flower stamp design kept");
  assert(a[my * 200 + mx] > 180, "flower stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "flower stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around flower stamp gone");
  assert(a[35 * 200 + 35] < 16, "flower stamp notch not filled");
  assert(cut.pipeline === "timbre", "flower stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillFlower(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `flower product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillFlower(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `flower product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "flower product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around flower product gone");
}

function punchButterfly(img, cx, cy, rx, ry) {
  const verts = butterflyVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillButterfly(img, 100, 100, 40, 42, 40, 90, 160);
  const holes = punchButterfly(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `butterfly stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = butterflyVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[0] > tip[0]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "butterfly stamp design kept");
  assert(a[my * 200 + mx] > 180, "butterfly stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "butterfly stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around butterfly stamp gone");
  assert(a[100 * 200 + 162] < 16, "butterfly stamp notch not filled");
  assert(cut.pipeline === "timbre", "butterfly stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillButterfly(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `butterfly product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillButterfly(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `butterfly product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "butterfly product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around butterfly product gone");
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

function fillLeaf(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = leafVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function punchLeaf(img, cx, cy, rx, ry) {
  const verts = leafVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillLeaf(img, 100, 100, 40, 42, 40, 90, 160);
  const holes = punchLeaf(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `leaf stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = leafVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[0] > tip[0]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "leaf stamp design kept");
  assert(a[my * 200 + mx] > 180, "leaf stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "leaf stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around leaf stamp gone");
  assert(a[168 * 200 + 40] < 16, "leaf stamp stem notch not filled");
  assert(cut.pipeline === "timbre", "leaf stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillLeaf(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `leaf product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillLeaf(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `leaf product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "leaf product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around leaf product gone");
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

function fillFish(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = fishVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function punchFish(img, cx, cy, rx, ry) {
  const verts = fishVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillFish(img, 100, 100, 40, 42, 40, 90, 160);
  const holes = punchFish(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `fish stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = fishVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[0] > tip[0]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "fish stamp design kept");
  assert(a[my * 200 + mx] > 180, "fish stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "fish stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around fish stamp gone");
  assert(a[100 * 200 + 30] < 16, "fish stamp tail fork not filled");
  assert(cut.pipeline === "timbre", "fish stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillFish(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `fish product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillFish(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `fish product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "fish product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around fish product gone");
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

function fillBird(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = birdVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function punchBird(img, cx, cy, rx, ry) {
  const verts = birdVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillBird(img, 100, 100, 40, 42, 50, 80, 140);
  const holes = punchBird(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `bird stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = birdVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[0] > tip[0]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "bird stamp design kept");
  assert(a[my * 200 + mx] > 180, "bird stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "bird stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around bird stamp gone");
  assert(a[40 * 200 + 160] < 16, "bird stamp above beak not filled");
  assert(cut.pipeline === "timbre", "bird stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillBird(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `bird product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillBird(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `bird product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "bird product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around bird product gone");
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

function fillCat(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = catVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function punchCat(img, cx, cy, rx, ry) {
  const verts = catVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillCat(img, 100, 100, 40, 42, 60, 50, 40);
  const holes = punchCat(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `cat stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = catVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[0] > tip[0]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "cat stamp design kept");
  assert(a[my * 200 + mx] > 180, "cat stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "cat stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around cat stamp gone");
  assert(a[28 * 200 + 100] < 16, "cat stamp between ears not filled");
  assert(cut.pipeline === "timbre", "cat stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillCat(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `cat product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillCat(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `cat product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "cat product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around cat product gone");
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

function fillDog(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = dogVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function punchDog(img, cx, cy, rx, ry) {
  const verts = dogVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillDog(img, 100, 100, 40, 42, 90, 70, 40);
  const holes = punchDog(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `dog stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = dogVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[0] > tip[0]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "dog stamp design kept");
  assert(a[my * 200 + mx] > 180, "dog stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "dog stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around dog stamp gone");
  assert(a[40 * 200 + 164] < 16, "dog stamp above snout not filled");
  assert(cut.pipeline === "timbre", "dog stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillDog(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `dog product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillDog(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `dog product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "dog product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around dog product gone");
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

function fillRabbit(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = rabbitVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function punchRabbit(img, cx, cy, rx, ry) {
  const verts = rabbitVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillRabbit(img, 100, 100, 40, 42, 90, 70, 40);
  const holes = punchRabbit(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `rabbit stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = rabbitVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[0] > tip[0]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "rabbit stamp design kept");
  assert(a[my * 200 + mx] > 180, "rabbit stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "rabbit stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around rabbit stamp gone");
  assert(a[32 * 200 + 100] < 16, "rabbit stamp between ears not filled");
  assert(cut.pipeline === "timbre", "rabbit stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillRabbit(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `rabbit product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillRabbit(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `rabbit product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "rabbit product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around rabbit product gone");
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

function fillSquirrel(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = squirrelVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function punchSquirrel(img, cx, cy, rx, ry) {
  const verts = squirrelVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillSquirrel(img, 100, 100, 40, 42, 140, 90, 40);
  const holes = punchSquirrel(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `squirrel stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = squirrelVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[0] > tip[0]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "squirrel stamp design kept");
  assert(a[my * 200 + mx] > 180, "squirrel stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "squirrel stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around squirrel stamp gone");
  assert(a[36 * 200 + 100] < 16, "squirrel stamp between tail and ear not filled");
  assert(cut.pipeline === "timbre", "squirrel stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillSquirrel(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `squirrel product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillSquirrel(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `squirrel product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "squirrel product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around squirrel product gone");
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

function fillFox(image, cx, cy, rx, ry, rr, gg, bb) {
  const pts = foxVerts(cx, cy, rx, ry);
  const n = pts.length;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(image.width - 1, Math.ceil(maxX));
  maxY = Math.min(image.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
        if (hit) inside = !inside;
      }
      if (!inside) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = rr; image.data[i + 1] = gg; image.data[i + 2] = bb; image.data[i + 3] = 255;
    }
  }
}

function punchFox(img, cx, cy, rx, ry) {
  const verts = foxVerts(cx, cy, rx, ry);
  const holes = [];
  for (let s = 0; s < 16; s++) {
    const [x0, y0] = verts[s];
    const [x1, y1] = verts[(s + 1) % 16];
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      fillCircle(img, x, y, 2, 8, 8, 8);
      holes.push([x, y]);
    }
  }
  return holes;
}

{
  const img = rgb(200, 200, 236, 214, 176);
  fillFox(img, 100, 100, 40, 42, 180, 90, 30);
  const holes = punchFox(img, 100, 100, 70, 74);
  const guess = classifyImage(img);
  assert(guess.mode === "timbre", `fox stamp classified (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  const large = foxVerts(100, 100, 70, 74);
  let tip = large[0];
  for (const v of large) if (v[0] > tip[0]) tip = v;
  const mx = Math.round(100 + (tip[0] - 100) * 0.72);
  const my = Math.round(100 + (tip[1] - 100) * 0.72);
  assert(a[100 * 200 + 100] > 180, "fox stamp design kept");
  assert(a[my * 200 + mx] > 180, "fox stamp paper margin kept (whole piece)");
  assert(a[holes[0][1] * 200 + holes[0][0]] < 16, "fox stamp perforation punched");
  assert(a[8 * 200 + 8] < 16, "album paper around fox stamp gone");
  assert(a[32 * 200 + 100] < 16, "fox stamp between ears not filled");
  assert(cut.pipeline === "timbre", "fox stamp uses stamp pipeline");
}

{
  const img = rgb(200, 200, 255, 255, 255);
  fillFox(img, 100, 100, 56, 58, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `fox product on white is not a stamp (${guess.kind})`);
}

{
  const img = rgb(200, 120, 8, 8, 8);
  fillFox(img, 100, 60, 48, 50, 200, 40, 40);
  const guess = classifyImage(img);
  assert(guess.mode !== "timbre", `fox product on black is not a stamp (${guess.kind})`);
  const cut = fastCut(img);
  const a = alphaOf(cut.image);
  assert(a[60 * 200 + 100] > 180, "fox product on black kept");
  assert(a[2 * 200 + 2] < 16, "black studio around fox product gone");
}

console.log("engine window+stamp+eyes+logo+halo+pupils+corner+mixed+flat-color+opaque+foliage+white-frame+white-sky+products-on-white+white-casement+blown-sky+coil+studio-color+cyclorama+single-glass+round-glass+oval-glass+fanlight+night-wood+warm-wood+overcast-wood+lozenge+gable+quatrefoil+trapezoid+star+leaded-lattice+bullseye-boss+round-stamp+oval-stamp+diamond-stamp+hexagon-stamp+octagon-stamp+pentagon-stamp+triangle-stamp+star-stamp+heart-stamp+crescent-stamp+teardrop-stamp+shield-stamp+cross-stamp+arrow-stamp+cloud-stamp+clover-stamp+flower-stamp+butterfly-stamp+leaf-stamp+fish-stamp+bird-stamp+cat-stamp+dog-stamp+rabbit-stamp+squirrel-stamp+fox-stamp ok");
