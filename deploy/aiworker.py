#!/usr/bin/env python3
"""
PullBG AI micro-service — one rembg model loaded once, exposed on 127.0.0.1.
Only ever reached from the local worker for general objects.

POST /cut  (multipart: file) -> PNG with transparent background
GET  /health
"""
import io
import os
import sys

from flask import Flask, request, send_file
from rembg import new_session, remove

MODEL = os.environ.get("PULLBG_AI_MODEL", "isnet-general-use")
HOST = os.environ.get("PULLBG_AI_HOST", "127.0.0.1")
PORT = int(os.environ.get("PULLBG_AI_PORT", "8155"))

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024

print(f"[ai] loading rembg model '{MODEL}' ...", flush=True)
session = new_session(MODEL)
print("[ai] ready", flush=True)


@app.post("/cut")
def cut():
    f = request.files.get("file")
    if f is None:
        return {"error": "no file"}, 400
    data = f.read()
    try:
        out = remove(data, session=session, alpha_matting=False)
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}, 500
    png = io.BytesIO()
    png.write(out)
    png.seek(0)
    return send_file(png, mimetype="image/png")


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL}


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, threaded=False)