#!/usr/bin/env python3
"""
Export an output Excel from whatever images exist RIGHT NOW.

main.py only writes its Excel after all 55 items finish. This script builds one
at any moment from the images already on disk, so a long run is usable while it
is still going. It is read-only with respect to the pipeline: it never touches
progress.json, the lock, or the images, so it is safe to run mid-run.

Usage
    python export_excel.py                 # links only
    python export_excel.py --embed         # also embed a thumbnail per row
    python export_excel.py --only-done     # skip rows that have no image yet

The "Image Link" column is filled with whatever link is available, in order of
preference:  Drive URL (if the image was uploaded)  ->  local file path.
"""

import argparse
import json
import re
import sys
from datetime import datetime
from io import BytesIO
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter
from dotenv import load_dotenv

import imgbb
from menu_source import pick_input_excel

load_dotenv()

BASE_DIR = Path(__file__).parent.resolve()
INPUT_DIR = BASE_DIR / "input"
OUTPUT_DIR = BASE_DIR / "output"
IMAGES_DIR = OUTPUT_DIR / "images"
PROGRESS_FILE = OUTPUT_DIR / "progress.json"

THUMB_PX = 90          # embedded thumbnail size
ROW_HEIGHT = 70        # points, when embedding


def load_progress() -> dict:
    """Map row number -> stored result dict. Missing/locked file is not fatal."""
    if not PROGRESS_FILE.exists():
        return {}
    try:
        data = json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  ! could not read progress.json ({e}) — using images dir only")
        return {}
    out = {}
    for key, result in (data.get("completed") or {}).items():
        m = re.match(r"^(\d+)_", key)
        if m:
            out[int(m.group(1))] = result
    return out


def scan_images() -> dict:
    """Map row number -> image Path, taken from the 4-digit filename prefix."""
    found = {}
    if not IMAGES_DIR.exists():
        return found
    for f in sorted(IMAGES_DIR.glob("*.jpg")):
        m = re.match(r"^(\d+)_", f.name)
        if m and f.stat().st_size > 0:
            found[int(m.group(1))] = f
    return found


def link_for(row: int, progress: dict, images: dict) -> str:
    # public imgbb URL wins — it is the only link a menu system can actually load
    img = images.get(row)
    if img:
        hosted = imgbb.cached_url(img)
        if hosted:
            return hosted
    result = progress.get(row) or {}
    drive_id = result.get("drive_id")
    if drive_id:
        return f"https://drive.google.com/uc?export=view&id={drive_id}"
    img = images.get(row)
    if img:
        return str(img)
    return result.get("local", "")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--embed", action="store_true",
                    help="embed a thumbnail of each image into the sheet")
    ap.add_argument("--only-done", action="store_true",
                    help="drop rows that have no image yet")
    ap.add_argument("--upload", action="store_true",
                    help="upload images to imgbb first, so the Excel gets public URLs")
    args = ap.parse_args()

    src, why = pick_input_excel(INPUT_DIR)
    if src is None:
        print(f"X {why}")
        sys.exit(1)

    progress = load_progress()
    images = scan_images()
    print(f"  input Excel : {src.name}  [{why}]")
    print(f"  images found: {len(images)}")

    if not images:
        print("X No images in output/images yet — nothing to export.")
        sys.exit(1)

    if args.upload:
        if not imgbb.get_api_key():
            print("X IMGBB_API_KEY is not set in .env")
            print("  Get a free key at https://api.imgbb.com/ then add:")
            print("      IMGBB_API_KEY=your_key_here")
            sys.exit(1)
        todo = [(r, p) for r, p in sorted(images.items()) if not imgbb.cached_url(p)]
        print(f"  uploading   : {len(todo)} new, {len(images) - len(todo)} already hosted")
        failed = 0
        for i, (row, path) in enumerate(todo, 1):
            try:
                url = imgbb.upload(path)
                print(f"    [{i}/{len(todo)}] {path.name} -> {url}")
            except Exception as e:
                failed += 1
                print(f"    [{i}/{len(todo)}] {path.name} FAILED: {e}")
        if failed:
            print(f"  ! {failed} upload(s) failed — re-run to retry just those")

    wb = openpyxl.load_workbook(src)
    ws = wb.active

    # locate (or create) the Image Link column
    headers = [str(c.value).strip().lower() if c.value else "" for c in ws[1]]
    img_col = None
    for i, h in enumerate(headers):
        if "image" in h or "link" in h:
            img_col = i + 1
            break
    if img_col is None:
        img_col = len(headers) + 1
        ws.cell(row=1, column=img_col, value="Image Link")

    thumb_col = img_col + 1 if args.embed else None
    if args.embed:
        ws.cell(row=1, column=thumb_col, value="Preview")
        ws.column_dimensions[get_column_letter(thumb_col)].width = 14
    ws.column_dimensions[get_column_letter(img_col)].width = 60

    filled = 0
    blank_rows = []
    for row in range(2, ws.max_row + 1):
        if not ws.cell(row=row, column=1).value:
            continue
        url = link_for(row, progress, images)
        if url:
            ws.cell(row=row, column=img_col, value=url)
            filled += 1
        else:
            blank_rows.append(row)

        if args.embed and images.get(row):
            try:
                from PIL import Image as PILImage
                from openpyxl.drawing.image import Image as XLImage
                im = PILImage.open(images[row]).convert("RGB")
                im.thumbnail((THUMB_PX, THUMB_PX))
                buf = BytesIO()
                im.save(buf, format="PNG")
                buf.seek(0)
                xi = XLImage(buf)
                ws.add_image(xi, f"{get_column_letter(thumb_col)}{row}")
                ws.row_dimensions[row].height = ROW_HEIGHT
            except Exception as e:
                print(f"  ! could not embed row {row}: {e}")

    # optionally drop not-yet-generated rows (delete bottom-up so indices hold)
    if args.only_done and blank_rows:
        for row in sorted(blank_rows, reverse=True):
            ws.delete_rows(row)
        print(f"  dropped {len(blank_rows)} rows with no image yet")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    suffix = "_partial" if blank_rows and not args.only_done else ""
    out = OUTPUT_DIR / f"output_{src.stem}_{ts}{suffix}.xlsx"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    wb.close()

    print(f"\nOK  {filled} rows linked, {len(blank_rows)} still pending")
    print(f"    {out}")


if __name__ == "__main__":
    main()
