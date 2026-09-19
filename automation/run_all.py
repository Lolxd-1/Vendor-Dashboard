#!/usr/bin/env python3
"""
THE WHOLE CYCLE - menu photographs in, SmartBiz upload sheet out.

    input/Menu Images/*.jpg
        |
        |  1. extract_menu.py     read the boards with Gemini vision
        v
    input/menu_items.xlsx         Item Name | Category | Price | Description
        |
        |  2. main.py             generate a food photo per item
        v
    output/images/*.jpg
        |
        |  3. host_images.py      turn each image into a public URL
        v
    public https://i.ibb.co/... links
        |
        |  4. smartbiz_export.py  fill the real SmartBiz bulk-upload template
        v
    output/smartbiz_upload_<timestamp>.xlsx

Every stage resumes. Stop it, lose the internet, close the laptop - run it
again and it picks up exactly where it left off, without re-spending a single
API call on work already done.

Usage
    python run_all.py                    # the whole cycle
    python run_all.py --review           # STOP after stage 1 so you can check prices
    python run_all.py --from generate    # skip extraction, resume image generation
    python run_all.py --from host        # just host the images and export
    python run_all.py --from export      # just rebuild the SmartBiz sheet
    python run_all.py --all-items        # export rows that have no image yet too
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path

# Windows consoles default to cp1252 and raise UnicodeEncodeError on the box
# characters and spinner glyphs Rich draws with. Force UTF-8 before Rich builds
# its Console (it samples the encoding at construction time).
for _stream in ("stdout", "stderr"):
    _s = getattr(sys, _stream, None)
    if _s is not None and hasattr(_s, "reconfigure"):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

BASE_DIR = Path(__file__).parent.resolve()
INPUT_DIR = BASE_DIR / "input"
OUTPUT_DIR = BASE_DIR / "output"
MENU_DIR = INPUT_DIR / "Menu Images"
MENU_XLSX = INPUT_DIR / "menu_items.xlsx"

console = Console()

STAGES = ["extract", "generate", "host", "export"]


def banner(n: int, total: int, title: str, detail: str = ""):
    console.print()
    console.print(Panel(f"[bold white]STAGE {n}/{total} - {title}[/]"
                        + (f"\n[dim]{detail}[/]" if detail else ""),
                        border_style="bright_magenta", padding=(0, 3)))


def run_stage(name: str, argv: list) -> int:
    """Run a pipeline script as a child process, streaming its output."""
    cmd = [sys.executable, str(BASE_DIR / name)] + argv
    console.print(f"[dim]$ {' '.join(cmd[1:])}[/]\n")
    try:
        return subprocess.call(cmd, cwd=str(BASE_DIR))
    except KeyboardInterrupt:
        raise
    except Exception as e:
        console.print(f"[bold red]X could not start {name}: {e}[/]")
        return 1


def count_rows(path: Path) -> int:
    try:
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True)
        ws = wb.active
        n = sum(1 for r in ws.iter_rows(min_row=2, values_only=True) if r and r[0])
        wb.close()
        return n
    except Exception:
        return 0


def count_images() -> int:
    d = OUTPUT_DIR / "images"
    return len([f for f in d.glob("*.jpg") if f.stat().st_size > 0]) if d.exists() else 0


def count_hosted() -> int:
    """How many images already have a public URL recorded."""
    try:
        import imgbb
        d = OUTPUT_DIR / "images"
        if not d.exists():
            return 0
        return sum(1 for f in d.glob("*.jpg")
                   if f.stat().st_size > 0 and imgbb.cached_url(f))
    except Exception:
        return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="start", choices=STAGES, default="extract",
                    help="start at this stage instead of the beginning")
    ap.add_argument("--review", action="store_true",
                    help="stop after extraction so you can check the sheet by hand")
    ap.add_argument("--all-items", action="store_true",
                    help="include items with no hosted image in the SmartBiz sheet")
    ap.add_argument("--force-extract", action="store_true",
                    help="re-read every menu photo, ignoring the extraction cache")
    ap.add_argument("--business-category", default=None)
    ap.add_argument("--product-category", default=None)
    args = ap.parse_args()

    t0 = time.time()
    start_at = STAGES.index(args.start)

    console.print(Panel("[bold white]MENU PHOTOS  ->  SMARTBIZ UPLOAD SHEET[/]\n"
                        "[dim]every stage resumes; nothing is ever generated twice[/]",
                        border_style="bright_cyan", padding=(1, 4)))

    # ---------- STAGE 1: photos -> Excel ----------
    if start_at <= 0:
        banner(1, 4, "READ THE MENU PHOTOS", str(MENU_DIR))
        extra = ["--force"] if args.force_extract else []
        rc = run_stage("extract_menu.py", extra)
        if rc != 0 and not MENU_XLSX.exists():
            console.print("\n[bold red]X Extraction produced no sheet - stopping.[/]")
            return 1
        if rc != 0:
            console.print("\n[yellow]! Some photos failed, but a sheet was written. "
                          "Re-run later to pick up the rest.[/]")

    if not MENU_XLSX.exists() and start_at <= 1:
        console.print(f"\n[bold red]X {MENU_XLSX.name} does not exist.[/]")
        console.print("  Put menu photos in input/Menu Images/ and run without --from.")
        return 1

    n_items = count_rows(MENU_XLSX)

    if args.review:
        console.print(Panel(
            f"[bold]{n_items}[/] items in [bold]{MENU_XLSX}[/]\n\n"
            "[dim]Open it, fix anything the camera got wrong, delete rows you do not\n"
            "want images for, then continue with:[/]\n"
            "  [bold]python run_all.py --from generate[/]",
            title="[bold yellow]Paused for review[/]", border_style="yellow"))
        return 0

    # ---------- STAGE 2: Excel -> images ----------
    if start_at <= 1:
        before = count_images()
        banner(2, 4, "GENERATE THE FOOD IMAGES",
               f"{n_items} items - express-mode image quota is ~1 image / 30-90s, "
               f"so this is the slow stage")
        rc = run_stage("main.py", [])
        after = count_images()
        if rc != 0:
            console.print(f"\n[yellow]! Image generation exited with code {rc} "
                          f"({after - before} new image(s) this pass).[/]")
            console.print("[yellow]  Building the export from whatever finished. "
                          "Re-run to continue generating.[/]")

    # ---------- STAGE 3: images -> public URLs ----------
    if start_at <= 2:
        banner(3, 4, "HOST THE IMAGES",
               "SmartBiz needs a URL it can fetch, not a path on this laptop")
        run_stage("host_images.py", [])

    # ---------- STAGE 4: images -> SmartBiz sheet ----------
    banner(4, 4, "BUILD THE SMARTBIZ UPLOAD SHEET",
           "fills the real template, so its dropdowns and validations survive")
    export_args = []
    if args.all_items:
        export_args.append("--all")
    if args.business_category:
        export_args += ["--business-category", args.business_category]
    if args.product_category:
        export_args += ["--product-category", args.product_category]
    rc = run_stage("smartbiz_export.py", export_args)

    # ---------- summary ----------
    sheets = sorted(OUTPUT_DIR.glob("smartbiz_upload_*.xlsx"),
                    key=lambda p: p.stat().st_mtime, reverse=True)
    imgs = count_images()
    hosted = count_hosted()
    done = imgs >= n_items and hosted >= n_items and rc == 0

    console.print()
    summary = Table.grid(padding=(0, 2))
    summary.add_row("Menu photos", str(len(list(MENU_DIR.glob("*")))) if MENU_DIR.exists() else "0")
    summary.add_row("Items extracted", f"[bold]{n_items}[/]")
    summary.add_row("Images generated", f"[green bold]{imgs}[/] / {n_items}")
    summary.add_row("Images hosted", f"[green bold]{hosted}[/] / {imgs}"
                    if hosted >= imgs else f"[yellow bold]{hosted}[/] / {imgs}")
    summary.add_row("Elapsed", f"{(time.time() - t0) / 60:.1f} min")
    if sheets:
        summary.add_row("SmartBiz sheet", f"[bold]{sheets[0]}[/]")
    console.print(Panel(summary,
                        title="[bold]Cycle complete[/]" if done
                        else "[bold yellow]Cycle partially complete[/]",
                        border_style="green" if done else "yellow"))

    # What is left, and the exact command that finishes it.
    if imgs < n_items:
        console.print(f"[yellow]* {n_items - imgs} item(s) have no image yet - "
                      f"run [bold]python run_all.py --from generate[/] "
                      f"(finished items are never regenerated).[/]")
    if hosted < imgs:
        console.print(f"[yellow]* {imgs - hosted} image(s) are not hosted yet - "
                      f"run [bold]python run_all.py --from host[/] once imgbb "
                      f"accepts uploads again. The images themselves are safe.[/]")
    return rc


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted - every finished stage is saved. "
                      "Run again to resume.[/]")
        sys.exit(130)
