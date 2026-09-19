#!/usr/bin/env python3
"""
STAGE 3 - Generated images  ->  public URLs.

Uploads everything in output/images/ that is not hosted yet and records the
public URL in output/uploads.json. SmartBiz needs a URL it can fetch, not a
path on your laptop, so this is what turns a finished image into a usable
catalogue row.

Deliberately a SEPARATE stage from image generation. Generating an image costs
real Gemini quota and can take a minute; hosting is free and instant. Tying
them together means an image-host outage throws away expensive work. Here, the
images sit safely on disk and this stage can be re-run as often as needed -
already-hosted images are skipped, so a re-run only picks up what is missing.

If imgbb refuses new uploads for your key (HTTP 400, code 111 "Internal upload
error"), this stops immediately and says so. That error is account-level: a
692-byte test image gets it too, and re-posting bytes imgbb already stored
still succeeds. Waiting for the cap to reset, or putting a different
IMGBB_API_KEY in .env, is the only fix - retrying harder does nothing.

Usage
    python host_images.py              # host everything still pending
    python host_images.py --limit 5    # try just a few (useful to probe a cap)
    python host_images.py --status     # report only, upload nothing
"""

import argparse
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

from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.progress import BarColumn, Progress, SpinnerColumn, TextColumn, TimeElapsedColumn
from rich.table import Table

BASE_DIR = Path(__file__).parent.resolve()
load_dotenv(BASE_DIR / ".env")

import imgbb
from export_excel import scan_images

OUTPUT_DIR = BASE_DIR / "output"
IMAGES_DIR = OUTPUT_DIR / "images"

PACE_SECONDS = 1.5     # gentle gap between uploads; imgbb dislikes bursts

console = Console()


def split_hosted(images: dict):
    """Return (already hosted, still pending) as lists of (row, path)."""
    hosted, pending = [], []
    for row, path in sorted(images.items()):
        (hosted if imgbb.cached_url(path) else pending).append((row, path))
    return hosted, pending


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0,
                    help="upload at most N images this run (0 = no limit)")
    ap.add_argument("--status", action="store_true",
                    help="report what is hosted and what is not, upload nothing")
    ap.add_argument("--pace", type=float, default=PACE_SECONDS,
                    help=f"seconds between uploads (default {PACE_SECONDS})")
    args = ap.parse_args()

    console.print(Panel("[bold white]STAGE 3 - HOST THE IMAGES[/]",
                        border_style="bright_cyan", padding=(1, 4)))

    images = scan_images()
    if not images:
        console.print(f"[bold red]X No images in {IMAGES_DIR}[/]")
        console.print("  Run [bold]python main.py[/] first to generate them.")
        return 1

    hosted, pending = split_hosted(images)

    info = Table.grid(padding=(0, 2))
    info.add_row("Images on disk", f"[bold]{len(images)}[/]")
    info.add_row("Already hosted", f"[green]{len(hosted)}[/]")
    info.add_row("Still pending", f"[yellow]{len(pending)}[/]")
    console.print(info)
    console.print()

    if args.status:
        return 0 if not pending else 1

    if not pending:
        console.print("[green]All images are hosted - nothing to do.[/]")
        return 0

    if not imgbb.get_api_key():
        console.print("[bold red]X IMGBB_API_KEY is not set in .env[/]")
        console.print("  Get a free key at https://api.imgbb.com/ and add:")
        console.print("      IMGBB_API_KEY=your_key_here")
        return 1

    todo = pending[:args.limit] if args.limit > 0 else pending
    uploaded, failed = 0, []
    capped = None

    with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"),
                  BarColumn(bar_width=36), TextColumn("({task.completed}/{task.total})"),
                  TimeElapsedColumn(), console=console) as prog:
        task = prog.add_task("Hosting images", total=len(todo))
        for i, (row, path) in enumerate(todo):
            try:
                url = imgbb.upload(path)
                if url:
                    uploaded += 1
                else:
                    failed.append((path.name, "empty URL returned"))
            except imgbb.ImgbbUploadCap as e:
                capped = str(e)
                break
            except Exception as e:
                failed.append((path.name, f"{type(e).__name__}: {str(e)[:140]}"))
            prog.advance(task)
            if i < len(todo) - 1 and args.pace > 0:
                time.sleep(args.pace)

    still_pending = len(pending) - uploaded

    console.print()
    if capped:
        console.print(Panel(
            f"[bold red]imgbb refused a new upload.[/]\n\n"
            f"[dim]{capped}[/]\n\n"
            f"[bold]{uploaded}[/] hosted this run, [bold yellow]{still_pending}[/] still pending.\n\n"
            "This is an account-level cap on the API key, not a problem with your\n"
            "images - every new upload gets it, whatever the size. Options:\n"
            "  * wait for the cap to reset, then re-run [bold]python host_images.py[/]\n"
            "  * put a different [bold]IMGBB_API_KEY[/] in .env and re-run\n\n"
            "[dim]Your generated images are safe in output/images/ either way -\n"
            "nothing needs regenerating.[/]",
            title="[bold red]Hosting blocked[/]", border_style="red"))
        return 1

    summary = Table.grid(padding=(0, 2))
    summary.add_row("Hosted this run", f"[green bold]{uploaded}[/]")
    summary.add_row("Failed", f"[red]{len(failed)}[/]" if failed else "[green]0[/]")
    summary.add_row("Still pending", f"[yellow]{still_pending}[/]" if still_pending else "[green]0[/]")
    console.print(Panel(summary, title="[bold]Hosting complete[/]",
                        border_style="green" if not still_pending else "yellow"))

    if failed:
        console.print("\n[bold red]Failed uploads:[/]")
        for name, err in failed[:10]:
            console.print(f"  * {name}: [dim]{err}[/]")
        if len(failed) > 10:
            console.print(f"  ... and {len(failed) - 10} more")
        console.print("[yellow]  Re-run to retry just these.[/]")

    return 0 if not still_pending else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted - every finished upload is saved. "
                      "Run again to continue.[/]")
        sys.exit(130)
