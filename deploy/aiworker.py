#!/usr/bin/env python3
"""One rembg session at a time. Human-seg for portraits (fits 8 GB)."""
import gc
import io
import os

from flask import Flask, request, send_file
from rembg import new_session, remove

HOST = os.environ.get("PULLBG_AI_HOST", "127.0.0.1")
PORT = int(os.environ.get("PULLBG_AI_PORT", "8155"))
GENERAL = "isnet-general-use"
HUMAN = "u2net_human_seg"

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024

_loaded = {"name": None, "session": None}


def get_session(name: str):
    if _loaded["name"] == name and _loaded["session"] is not None:
        return _loaded["session"]
    print(f"[ai] switching to {name}", flush=True)
    _loaded["session"] = None
    gc.collect()
    _loaded["session"] = new_session(name)
    _loaded["name"] = name
    print(f"[ai] {name} ready", flush=True)
    return _loaded["session"]


def session_for(hint: str):
    want = HUMAN if hint == "person" else GENERAL
    try:
        return get_session(want)
    except Exception as err:
        if want == GENERAL:
            raise
        print(f"[ai] {want} unavailable ({err}); using {GENERAL}", flush=True)
        return get_session(GENERAL)


def run_cut(data: bytes, hint: str) -> bytes:
    out = remove(
        data,
        session=session_for(hint),
        alpha_matting=False,
        post_process_mask=True,
    )
    return bytes(out)


print("[ai] idle, models on demand", flush=True)


@app.post("/cut")
def cut():
    f = request.files.get("file")
    if f is None:
        return {"error": "no file"}, 400
    data = f.read()
    hint = (request.form.get("hint") or request.args.get("hint") or "auto").strip().lower()
    try:
        png = io.BytesIO(run_cut(data, hint))
        png.seek(0)
        return send_file(png, mimetype="image/png")
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}, 500


@app.get("/health")
def health():
    return {"ok": True, "loaded": _loaded["name"], "models": [GENERAL, HUMAN]}


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, threaded=False)
