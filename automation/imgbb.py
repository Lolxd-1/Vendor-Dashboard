#!/usr/bin/env python3
"""
imgbb upload helper.

Turns a local JPEG into a public direct URL (https://i.ibb.co/...) that a menu
system, website or POS can load. Used by both main.py (during a run) and
export_excel.py (retroactively, for images already on disk).

Upload results are cached in output/uploads.json so an image is never uploaded
twice. That file is owned by this module ALONE — progress.json belongs to the
running pipeline and is never touched here.

Get a free API key at https://api.imgbb.com/  (sign in -> "Get API key"),
then put it in .env:

    IMGBB_API_KEY=your_key_here
"""

import base64
import json
import os
import threading
import time
from pathlib import Path
from typing import Dict, Optional

import requests

BASE_DIR = Path(__file__).parent.resolve()
UPLOADS_FILE = BASE_DIR / "output" / "uploads.json"

API_URL = "https://api.imgbb.com/1/upload"
MAX_BYTES = 32 * 1024 * 1024      # imgbb hard limit
TIMEOUT = 60
MAX_RETRIES = 4

_lock = threading.Lock()
_cache: Optional[Dict[str, dict]] = None


class ImgbbUploadCap(RuntimeError):
    """imgbb is refusing every new upload for this key (HTTP 400, code 111).

    Distinct from an ordinary upload failure: nothing about the image is wrong
    and no amount of retrying will help, so a batch should stop rather than
    grind through the rest one doomed upload at a time.
    """


def _is_upload_cap(body: str) -> bool:
    b = (body or "").lower()
    return '"code":111' in b.replace(" ", "") or "internal upload error" in b


def get_api_key() -> str:
    key = os.getenv("IMGBB_API_KEY", "").strip()
    return key


def _load_cache() -> Dict[str, dict]:
    global _cache
    if _cache is None:
        if UPLOADS_FILE.exists():
            try:
                _cache = json.loads(UPLOADS_FILE.read_text(encoding="utf-8"))
            except Exception:
                _cache = {}
        else:
            _cache = {}
    return _cache


def _save_cache():
    UPLOADS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = UPLOADS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(_cache, indent=2), encoding="utf-8")
    tmp.replace(UPLOADS_FILE)      # atomic-ish; never leaves a half-written file


def cached_url(image_path: Path) -> str:
    """Return the already-uploaded URL for this file, or '' if not uploaded."""
    with _lock:
        entry = _load_cache().get(image_path.name)
    return (entry or {}).get("url", "")


def upload(image_path: Path, api_key: str = "", force: bool = False) -> str:
    """
    Upload one image and return its direct URL. Returns '' on failure.

    Cached: calling this again for the same filename is free and makes no
    network request unless force=True.
    """
    image_path = Path(image_path)
    if not force:
        hit = cached_url(image_path)
        if hit:
            return hit

    api_key = api_key or get_api_key()
    if not api_key:
        raise RuntimeError(
            "IMGBB_API_KEY is not set. Get a free key at https://api.imgbb.com/ "
            "and add IMGBB_API_KEY=... to your .env"
        )

    if not image_path.exists() or image_path.stat().st_size == 0:
        return ""
    size = image_path.stat().st_size
    if size > MAX_BYTES:
        raise RuntimeError(f"{image_path.name} is {size/1e6:.1f} MB — over imgbb's 32 MB limit")

    payload = base64.b64encode(image_path.read_bytes()).decode("ascii")

    last_err = ""
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(
                API_URL,
                data={"key": api_key, "image": payload, "name": image_path.stem},
                timeout=TIMEOUT,
            )
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            time.sleep(min(3 * (2 ** attempt), 30))
            continue

        if resp.status_code == 200:
            try:
                data = resp.json()["data"]
            except Exception as e:
                last_err = f"unexpected response: {resp.text[:200]} ({e})"
                break
            url = data.get("url") or data.get("display_url") or ""
            if url:
                with _lock:
                    _load_cache()[image_path.name] = {
                        "url": url,
                        "display_url": data.get("display_url", ""),
                        "delete_url": data.get("delete_url", ""),
                        "uploaded": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    }
                    _save_cache()
            return url

        # 400 with a bad key is permanent — don't burn retries on it.
        if resp.status_code == 400 and "key" in resp.text.lower():
            raise RuntimeError(f"imgbb rejected the API key: {resp.text[:200]}")

        # 400 / code 111 "Internal upload error" is imgbb's account-level upload
        # cap, not a problem with this file — a 692-byte test image gets it too,
        # while re-posting bytes imgbb already stored still returns 200. Retrying
        # harder never helps, so surface it as its own error and let the caller
        # stop the whole batch instead of failing 56 images one at a time.
        if resp.status_code == 400 and _is_upload_cap(resp.text):
            raise ImgbbUploadCap(
                "imgbb is refusing all new uploads for this API key "
                f"(HTTP 400, code 111). Response: {resp.text[:150]}"
            )

        last_err = f"HTTP {resp.status_code}: {resp.text[:200]}"
        if resp.status_code in (429, 500, 502, 503, 504):
            time.sleep(min(5 * (2 ** attempt), 60))
            continue
        break

    raise RuntimeError(f"imgbb upload failed for {image_path.name} — {last_err}")
