#!/usr/bin/env python3
"""ISNet two-pass + int8 + guided-filter edges. 8 GB safe."""
import gc
import io
import os
import re

from flask import Flask, request, send_file
from rembg import new_session, remove
from PIL import Image, ImageFilter
import numpy as np

HOST = os.environ.get("PULLBG_AI_HOST", "127.0.0.1")
PORT = int(os.environ.get("PULLBG_AI_PORT", "8155"))
INT8 = os.environ.get(
    "PULLBG_ISNET_INT8",
    "/home/pullbg/.rembg/models/isnet-general-use/isnet-general-use.int8.onnx",
)
FULL_EDGE = 1400
COARSE_EDGE = 720
CROP_EDGE = 1200

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024

_session = None
_kind = None


def session():
    global _session, _kind
    if _session is not None:
        return _session
    if os.path.isfile(INT8):
        print(f"[ai] loading isnet int8 {INT8}", flush=True)
        _session = new_session("dis_custom", model_path=INT8)
        _kind = "isnet-int8"
    else:
        print("[ai] loading isnet-general-use fp32", flush=True)
        _session = new_session("isnet-general-use")
        _kind = "isnet-fp32"
    print(f"[ai] ready {_kind}", flush=True)
    return _session


def to_png(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def fit_im(im: Image.Image, edge: int) -> Image.Image:
    out = im.convert("RGB")
    out.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    return out


def box_mean(arr: np.ndarray, r: int) -> np.ndarray:
    """Integral-image box mean. arr is 2D float32."""
    h, w = arr.shape
    pad = np.pad(arr, ((r + 1, r), (r + 1, r)), mode="edge")
    s = pad.cumsum(0).cumsum(1)
    k = (2 * r + 1) ** 2
    return (s[2 * r + 1 :, 2 * r + 1 :] - s[2 * r + 1 :, :w] - s[:h, 2 * r + 1 :] + s[:h, :w]) / k


def guided_alpha(rgb: Image.Image, alpha: Image.Image, radius: int = 4, eps: float = 1e-3) -> Image.Image:
    """Edge-aware refine of alpha using luma as guide."""
    guide = np.asarray(rgb.convert("L"), dtype=np.float32) / 255.0
    src = np.asarray(alpha, dtype=np.float32) / 255.0
    mean_i = box_mean(guide, radius)
    mean_p = box_mean(src, radius)
    mean_ip = box_mean(guide * src, radius)
    mean_ii = box_mean(guide * guide, radius)
    var_i = np.maximum(mean_ii - mean_i * mean_i, 0)
    cov = mean_ip - mean_i * mean_p
    a = cov / (var_i + eps)
    b = mean_p - a * mean_i
    q = box_mean(a, radius) * guide + box_mean(b, radius)
    q = np.clip(q * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(q, mode="L")


def parse_orders(note: str) -> dict:
    n = (note or "").lower()
    hair = bool(re.search(r"cheveu|mèche|meche|hair|frange|matting=1", n))
    tight = bool(re.search(r"trop coup|mangé|mange|manque|épaule|epaule|grow=", n))
    leftover = bool(re.search(r"fond|reste|halo|ciel|erode=1", n))
    matting = "matting=1" in n or hair
    fur = bool(re.search(r"fur|poil|fourrure", n))
    erode = 6
    m = re.search(r"erode=(\d+)", n)
    if m:
        erode = int(m.group(1))
    elif leftover:
        erode = 10
    elif hair or tight:
        erode = 4
    grow = 0
    g = re.search(r"grow=(\d+)", n)
    if g:
        grow = int(g.group(1))
    elif fur:
        leftover = True
        grow = 0
    elif hair:
        grow = 1
    elif tight:
        grow = 2
    return {
        "hair": hair,
        "tight": tight,
        "leftover": leftover,
        "matting": matting,
        "erode": max(4, min(12, erode)),
        "grow": max(0, min(4, grow)),
        "crop": "nocrop" not in n,
    }


def rembg_once(png: bytes, orders: dict, allow_matte: bool) -> bytes:
    kw = dict(session=session(), post_process_mask=False, decontaminate=True, alpha_matting=False)
    if allow_matte and orders["matting"]:
        try:
            return bytes(remove(
                png,
                **{**kw, "alpha_matting": True,
                   "alpha_matting_foreground_threshold": 230,
                   "alpha_matting_background_threshold": 12,
                   "alpha_matting_erode_size": orders["erode"]},
            ))
        except Exception as err:
            print(f"[ai] matting skip ({err})", flush=True)
            gc.collect()
    return bytes(remove(png, **kw))


def bbox(alpha: np.ndarray, thr: int = 18, pad: float = 0.14):
    ys, xs = np.where(alpha > thr)
    if xs.size < 40:
        return None
    h, w = alpha.shape
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    pw = int((x1 - x0) * pad)
    ph = int((y1 - y0) * pad)
    return (
        max(0, x0 - pw),
        max(0, y0 - ph),
        min(w, x1 + pw),
        min(h, y1 + ph),
    )


def fuse_masks(coarse: Image.Image, fine: Image.Image) -> Image.Image:
    if coarse.size != fine.size:
        coarse = coarse.resize(fine.size, Image.Resampling.BILINEAR)
    ac = np.asarray(coarse.split()[-1], dtype=np.float32)
    af = np.asarray(fine.split()[-1], dtype=np.float32)
    fused = 0.35 * ac + 0.65 * af
    disagree = np.abs(ac - af) > 40
    fused[disagree] = np.maximum(ac, af)[disagree]
    r, g, b, _ = fine.split()
    a = Image.fromarray(np.clip(fused, 0, 255).astype(np.uint8), "L")
    return Image.merge("RGBA", (r, g, b, a))


def stick_fringe(a: Image.Image) -> Image.Image:
    """Drop floating halo. Messy masks keep mid-alpha only next to solid subject."""
    arr = np.asarray(a)
    fringe = float(((arr > 8) & (arr < 180)).mean())
    hard_thr, rad = (160, 7) if fringe >= 0.06 else (80, 5)
    hard = a.point(lambda p: 255 if p >= hard_thr else 0)
    near = hard.filter(ImageFilter.MaxFilter(rad))
    keep = np.asarray(near) >= 128
    out = arr.copy()
    out[(arr < hard_thr) & ~keep] = 0
    return Image.fromarray(out, mode="L")


def _corner_seeds(rgb: np.ndarray, patch: int = 8, agree: float = 40.0) -> list:
    h, w = rgb.shape[:2]
    p = min(patch, h, w)
    corners = [
        rgb[:p, :p].mean((0, 1)),
        rgb[:p, -p:].mean((0, 1)),
        rgb[-p:, :p].mean((0, 1)),
        rgb[-p:, -p:].mean((0, 1)),
    ]
    seeds = []
    for c in corners:
        near = sum(float(np.max(np.abs(c - other))) <= agree for other in corners)
        chroma = float(np.max(c) - np.min(c))
        mean = float(c.mean())
        if near >= 2 and chroma >= 20 and 50 <= mean <= 220:
            seeds.append(c)
    return seeds


def drop_studio(guide_rgb: Image.Image, alpha: Image.Image) -> Image.Image:
    """Drop colored cyclorama leftover on the frame. Skip gray/black/white and clean cuts."""
    rgb = np.asarray(guide_rgb.convert("RGB"), dtype=np.int16)
    arr = np.asarray(alpha)
    h, w = arr.shape
    bw, bh = max(2, w // 50), max(2, h // 50)
    frame = np.zeros((h, w), dtype=bool)
    frame[:bh] = True
    frame[-bh:] = True
    frame[:, :bw] = True
    frame[:, -bw:] = True
    fg = arr > 32
    leftover = float((fg & frame).mean())
    fg_n = int(fg.sum()) or 1
    if (fg & frame).sum() / fg_n > 0.08:
        leftover = 0.0
    if leftover < 0.010:
        return alpha
    seeds = _corner_seeds(rgb)
    if len(seeds) < 2:
        return alpha
    band_w = max(2, int(round(w * 0.04)))
    band_h = max(2, int(round(h * 0.04)))
    band = np.zeros((h, w), dtype=bool)
    band[:band_h] = True
    band[-band_h:] = True
    band[:, :band_w] = True
    band[:, -band_w:] = True
    dist = np.min([np.max(np.abs(rgb - s.astype(np.int16)), axis=2) for s in seeds], axis=0)
    out = arr.copy()
    out[band & (dist <= 36)] = 0
    return Image.fromarray(out, mode="L")


def drop_bg_leftover(guide_rgb: Image.Image, alpha: Image.Image) -> Image.Image:
    """Drop frame leftover whose color matches the corners, not the subject."""
    rgb = np.asarray(guide_rgb.convert("RGB"), dtype=np.int16)
    arr = np.asarray(alpha)
    h, w = arr.shape
    bw, bh = max(2, w // 50), max(2, h // 50)
    frame = np.zeros((h, w), dtype=bool)
    frame[:bh] = True
    frame[-bh:] = True
    frame[:, :bw] = True
    frame[:, -bw:] = True
    fg = arr > 32
    leftover_m = fg & frame
    leftover = float(leftover_m.mean())
    fg_n = int(fg.sum()) or 1
    if leftover_m.sum() / fg_n > 0.08 or leftover < 0.005:
        return alpha
    interior = fg & ~frame
    if leftover_m.sum() < 20 or interior.sum() < 40:
        return alpha
    p = min(8, h, w)
    corners = [
        rgb[:p, :p].mean((0, 1)),
        rgb[:p, -p:].mean((0, 1)),
        rgb[-p:, :p].mean((0, 1)),
        rgb[-p:, -p:].mean((0, 1)),
    ]
    seeds = []
    for c in corners:
        near = sum(float(np.max(np.abs(c - other))) <= 48 for other in corners)
        if near >= 2:
            seeds.append(c)
    if len(seeds) < 2:
        return alpha
    # Average leftover color is mixed subject+bg on the frame — drop per pixel
    # only when the pixel matches a corner seed and is far from the subject.
    subj = rgb[interior].mean(0)
    dist = np.min([np.max(np.abs(rgb - s.astype(np.int16)), axis=2) for s in seeds], axis=0)
    dist_subj = np.max(np.abs(rgb - subj.astype(np.int16)), axis=2)
    out = arr.copy()
    out[leftover_m & (dist <= 44) & (dist_subj > 28)] = 0
    return Image.fromarray(out, mode="L")


def finish(raw: bytes, guide_rgb: Image.Image, orders: dict) -> bytes:
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    if im.size != guide_rgb.size:
        im = im.resize(guide_rgb.size, Image.Resampling.LANCZOS)
    r, g, b, a = im.split()
    if orders["grow"]:
        for _ in range(orders["grow"]):
            a = a.filter(ImageFilter.MaxFilter(3))
    if orders["leftover"] and not orders["tight"]:
        a = a.filter(ImageFilter.MinFilter(3))
    a = guided_alpha(guide_rgb, a, radius=3, eps=8e-4)
    a = stick_fringe(a)
    a = drop_studio(guide_rgb, a)
    a = drop_bg_leftover(guide_rgb, a)
    rgb = np.array(Image.merge("RGBA", (r, g, b, a)))
    cut = 1 if orders["hair"] or orders["tight"] else 4
    rgb[rgb[:, :, 3] < cut] = 0
    return to_png(Image.fromarray(rgb, "RGBA"))


def two_pass(data: bytes, orders: dict) -> bytes:
    full = fit_im(Image.open(io.BytesIO(data)), FULL_EDGE)
    coarse_png = rembg_once(to_png(fit_im(full, COARSE_EDGE)), orders, allow_matte=False)
    coarse = Image.open(io.BytesIO(coarse_png)).convert("RGBA")
    if coarse.size != full.size:
        coarse = coarse.resize(full.size, Image.Resampling.BILINEAR)
    box = bbox(np.array(coarse.split()[-1]))
    if not orders["crop"] or box is None:
        fine = Image.open(io.BytesIO(rembg_once(to_png(full), orders, allow_matte=True))).convert("RGBA")
        if fine.size != full.size:
            fine = fine.resize(full.size, Image.Resampling.LANCZOS)
        return finish(to_png(fuse_masks(coarse, fine)), full, orders)

    x0, y0, x1, y1 = box
    area = (x1 - x0) * (y1 - y0)
    if area >= 0.88 * full.size[0] * full.size[1]:
        fine = Image.open(io.BytesIO(rembg_once(to_png(full), orders, allow_matte=True))).convert("RGBA")
        if fine.size != full.size:
            fine = fine.resize(full.size, Image.Resampling.LANCZOS)
        return finish(to_png(fuse_masks(coarse, fine)), full, orders)

    crop = full.crop((x0, y0, x1, y1))
    crop_src = fit_im(crop, CROP_EDGE)
    fine_crop = Image.open(io.BytesIO(rembg_once(to_png(crop_src), orders, allow_matte=True))).convert("RGBA")
    fine_crop = fine_crop.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", full.size, (0, 0, 0, 0))
    canvas.paste(fine_crop, (x0, y0), fine_crop)
    return finish(to_png(fuse_masks(coarse, canvas)), full, orders)


print("[ai] idle two-pass int8+guided", flush=True)


@app.post("/cut")
def cut():
    f = request.files.get("file")
    if f is None:
        return {"error": "no file"}, 400
    data = f.read()
    note = (request.form.get("note") or "").strip()
    try:
        png = io.BytesIO(two_pass(data, parse_orders(note)))
        png.seek(0)
        return send_file(png, mimetype="image/png")
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}, 500
    finally:
        gc.collect()


@app.get("/health")
def health():
    return {"ok": True, "model": _kind, "mode": "two-pass-int8-guided-fuse", "loaded": _session is not None}


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, threaded=False)
