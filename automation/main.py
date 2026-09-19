"""
Restaurant Menu Image Automation Pipeline
==========================================
Generates food images using Gemini API, uploads to Google Drive & PostImages,
and creates an updated Excel sheet with direct image links.

Usage:
    1. Drop reference image in  reference/
    2. Drop Excel (.xlsx) in    input/
    3. Run:  python main.py
    4. Output Excel appears in  output/
"""

import os
import sys

# Windows terminals default to cp1252 and raise UnicodeEncodeError on the
# emoji used in the UI (and on any redirect to a file). Force UTF-8 early,
# before Rich builds its Console.
for _stream in ("stdout", "stderr"):
    _s = getattr(sys, _stream, None)
    if _s is not None and hasattr(_s, "reconfigure"):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
import json
import time
import threading
import atexit
import logging
import base64
from pathlib import Path
from io import BytesIO
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Dict, List


import openpyxl
from PIL import Image
from dotenv import load_dotenv
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn, TimeRemainingColumn
from rich.table import Table
from rich.panel import Panel
from rich import print as rprint

# ════════════════════════════════════════════════════════════
# CONFIGURATION
# ════════════════════════════════════════════════════════════

load_dotenv()

BASE_DIR = Path(__file__).parent.resolve()
REFERENCE_DIR = BASE_DIR / "reference"
INPUT_DIR = BASE_DIR / "input"
OUTPUT_DIR = BASE_DIR / "output"
IMAGES_DIR = OUTPUT_DIR / "images"
CREDENTIALS_DIR = BASE_DIR / "credentials"
PROGRESS_FILE = OUTPUT_DIR / "progress.json"
LOG_FILE = OUTPUT_DIR / "automation.log"

import imgbb
from menu_source import pick_input_excel

IMGBB_ENABLED = bool(os.getenv("IMGBB_API_KEY", "").strip())

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_BACKUP_KEY = os.getenv("GEMINI_BACKUP_KEY", "")
MODEL_NAME = "gemini-3.1-flash-lite-image"
ASPECT_RATIO = "1:1"       # square, as the prompt demands
IMAGE_SIZE = "1K"          # flash-lite-image supports 1K only (2K/4K -> 400)

DRIVE_FOLDER_ID = "12P13_QzqITOH_jfbjL1R0Mnr8w8FK_Up"

# Express-mode image quota is tiny and bursty -> generate strictly one at a time.
MAX_WORKERS = 1
MAX_RETRIES = 8
API_TIMEOUT = 90

# ── ADAPTIVE RATE CONTROL (express mode) ───────────────────
# Measured: express-mode image quota rejects bursts instantly and
# sustains roughly one image per ~30-60s on the free tier.
# The pace self-tunes: it grows on every 429, shrinks on success.
RATE_START_DELAY = 30.0    # seconds between calls at startup
RATE_MIN_DELAY = 8.0       # never go faster than this
RATE_MAX_DELAY = 120.0     # never go slower than this
RATE_GROW = 1.5            # multiply pace by this on a 429
RATE_SHRINK = 0.92         # multiply pace by this on a success
RATE_BACKOFF_BASE = 20.0   # first 429 sleep
RATE_BACKOFF_MAX = 300.0   # cap on 429 sleep
OUTPUT_SIZE = 1024      # Output image dimension (256×256)
REFERENCE_MAX_DIM = 256      # Resize ref image to match output (saves tokens)
JPEG_QUALITY = 100          # Single fixed quality — no iterative compression

# ── BUDGET CAP ─────────────────────────────────────────────
# Hard limit on Gemini API calls. Script stops after this many.
# Set to 0 for unlimited.
MAX_API_CALLS = 1000
# ───────────────────────────────────────────────────────────

# ── TEST MODE ──────────────────────────────────────────────
# Set to N to process first N items only.
# Set to 0 to process ALL items in the Excel.
TEST_LIMIT = int(os.getenv("TEST_LIMIT", "0"))   # 0 = all items; override via env for smoke tests

# ───────────────────────────────────────────────────────────

console = Console()

# ════════════════════════════════════════════════════════════
# LOGGING
# ════════════════════════════════════════════════════════════

def setup_logging():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-7s | %(message)s",
        datefmt="%H:%M:%S",
        handlers=[
            logging.FileHandler(LOG_FILE, encoding="utf-8"),
        ],
    )
    return logging.getLogger("pipeline")

logger = setup_logging()


# ════════════════════════════════════════════════════════════
# SINGLE-INSTANCE LOCK
# ════════════════════════════════════════════════════════════
# Two concurrent runs share one tiny express-mode quota and 429 each
# other into a standstill — nothing generates. Refuse to start a second.

LOCK_FILE = OUTPUT_DIR / ".run.lock"


def _pid_alive(pid: int) -> bool:
    """True if a process with this PID is currently running."""
    if pid <= 0:
        return False
    if os.name == "nt":
        # NB: os.kill(pid, 0) TERMINATES the process on Windows — never use it here.
        import ctypes
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        k32 = ctypes.windll.kernel32
        handle = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return False
        code = ctypes.c_ulong()
        ok = k32.GetExitCodeProcess(handle, ctypes.byref(code))
        k32.CloseHandle(handle)
        return bool(ok) and code.value == STILL_ACTIVE
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def acquire_single_instance_lock():
    """Exit if another run is already going. Registers cleanup on exit."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if LOCK_FILE.exists():
        try:
            other = int(LOCK_FILE.read_text(encoding="utf-8").split()[0])
        except Exception:
            other = -1
        if other != os.getpid() and _pid_alive(other):
            console.print(
                f"[bold red]✗ Another run is already in progress (PID {other}).[/]"
            )
            console.print(
                "  Two runs share one quota and stall each other — "
                "nothing would generate."
            )
            console.print(
                f"  Wait for it to finish, or stop it and delete [bold]{LOCK_FILE}[/]"
            )
            sys.exit(1)
        logger.info(f"Clearing stale lock from dead PID {other}")

    LOCK_FILE.write_text(f"{os.getpid()} {datetime.now().isoformat()}", encoding="utf-8")

    def _release():
        try:
            if LOCK_FILE.exists():
                held = int(LOCK_FILE.read_text(encoding="utf-8").split()[0])
                if held == os.getpid():
                    LOCK_FILE.unlink()
        except Exception:
            pass

    atexit.register(_release)


# ════════════════════════════════════════════════════════════
# PROGRESS TRACKER  (resume support)
# ════════════════════════════════════════════════════════════

class ProgressTracker:
    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.Lock()
        self.data: Dict = {"completed": {}, "failed": {}}
        self._load()

    def _load(self):
        if self._path.exists():
            with open(self._path, "r", encoding="utf-8") as f:
                self.data = json.load(f)
            done = len(self.data.get("completed", {}))
            fail = len(self.data.get("failed", {}))
            logger.info(f"Resumed progress — {done} completed, {fail} previously failed")

    def _save(self):
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=2, ensure_ascii=False)

    def is_done(self, key: str) -> bool:
        return key in self.data["completed"]

    def get_result(self, key: str) -> Optional[dict]:
        return self.data["completed"].get(key)

    def mark_done(self, key: str, result: dict):
        with self._lock:
            self.data["completed"][key] = result
            # Remove from failed if it was there before
            self.data["failed"].pop(key, None)
            self._save()

    def mark_failed(self, key: str, error: str):
        with self._lock:
            self.data["failed"][key] = {
                "error": error,
                "time": datetime.now().isoformat(),
            }
            self._save()


# ════════════════════════════════════════════════════════════
# EXCEL HANDLER
# ════════════════════════════════════════════════════════════

class ExcelHandler:
    @staticmethod
    def read_items(path: Path) -> List[Dict]:
        wb = openpyxl.load_workbook(path, read_only=True)
        ws = wb.active

        # --- detect headers (row 1) ---
        raw_headers = [
            str(c.value).strip().lower() if c.value else "" for c in ws[1]
        ]
        col = {}
        for i, h in enumerate(raw_headers):
            if ("item" in h and "name" in h) or h in ("item name", "item_name", "name"):
                col["name"] = i
            elif "desc" in h:
                col["description"] = i
            elif "categ" in h:
                col["category"] = i
            elif "price" in h:
                col["price"] = i
            elif "image" in h or "link" in h:
                col["image_link"] = i

        if "name" not in col:
            raise ValueError(
                f"Cannot find an 'Item Name' column. Found headers: {raw_headers}"
            )

        items = []
        for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            name_val = row[col["name"]]
            if not name_val:
                continue
            items.append(
                {
                    "row": row_idx,
                    "item_name": str(name_val).strip(),
                    "description": str(row[col["description"]] or "").strip() if col.get("description") is not None else "",
                    "category": str(row[col.get("category", 1)] or "").strip() if col.get("category") is not None else "",
                    "price": row[col.get("price", 2)] if col.get("price") is not None else "",
                    "image_link": "",
                }
            )
        wb.close()
        logger.info(f"Read {len(items)} items from {path.name}")
        return items

    @staticmethod
    def write_output(input_path: Path, items: List[Dict], output_path: Path):
        wb = openpyxl.load_workbook(input_path)
        ws = wb.active

        # find or create image link column
        headers = [
            str(c.value).strip().lower() if c.value else "" for c in ws[1]
        ]
        img_col = None
        for i, h in enumerate(headers):
            if "image" in h or "link" in h:
                img_col = i + 1  # openpyxl is 1-indexed
                break
        if img_col is None:
            img_col = len(headers) + 1
            ws.cell(row=1, column=img_col, value="Image Link")

        link_map = {it["row"]: it.get("postimage_url", "") for it in items}
        for r, url in link_map.items():
            ws.cell(row=r, column=img_col, value=url)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        wb.save(output_path)
        wb.close()
        logger.info(f"Output Excel saved → {output_path}")


# ════════════════════════════════════════════════════════════
# IMAGE GENERATOR  (Gemini API — one client per thread)
# ════════════════════════════════════════════════════════════

# ── Vertex AI Express Mode helpers ───────────────────────────
# The new key (AQ.*) is a Vertex AI *express mode* key. It authenticates
# against aiplatform.googleapis.com and carries its own project binding —
# no gcloud ADC, no project number, no OAuth token needed.

_RATE_MARKERS = (
    "429", "resource_exhausted", "resource has been exhausted",
    "quota", "rate limit", "too many requests",
)
_AUTH_MARKERS = (
    "401", "403", "unauthenticated", "permission_denied", "api key not valid",
    "invalid api key", "billing", "has not been used in project", "is disabled",
)


def _is_rate_limit(msg: str) -> bool:
    m = msg.lower()
    return any(k in m for k in _RATE_MARKERS)


def _is_auth_error(msg: str) -> bool:
    m = msg.lower()
    if _is_rate_limit(msg):
        return False
    return any(k in m for k in _AUTH_MARKERS)


def _finish_reason(resp) -> str:
    try:
        for c in (resp.candidates or []):
            fr = getattr(c, "finish_reason", None)
            if fr is not None:
                return str(fr)
    except Exception:
        pass
    return "UNKNOWN"


def _extract_image_bytes(resp) -> Optional[bytes]:
    """Pull the first inline image out of a generate_content response."""
    try:
        for c in (resp.candidates or []):
            content = getattr(c, "content", None)
            if not content:
                continue
            for p in (content.parts or []):
                inline = getattr(p, "inline_data", None)
                if inline is not None and inline.data:
                    return inline.data
    except Exception as e:
        logger.warning(f"  Could not parse response parts: {e}")
    return None


class ImageGenerator:
    """Thread-safe wrapper: each call to generate() creates its own client."""

    def __init__(self, api_key: str, backup_key: str):
        self.primary_key = api_key
        self.backup_key = backup_key
        self._active_key = api_key
        self._key_lock = threading.Lock()
        self._ref_image: Optional[Image.Image] = None
        self._ref_jpeg: Optional[bytes] = None
        self._api_calls = 0
        self._api_lock = threading.Lock()
        self._last_call_time = 0.0
        # Adaptive pacing state — shared by every worker thread.
        self._pace_lock = threading.Lock()
        self._delay = RATE_START_DELAY
        self._next_allowed = 0.0
        # One SDK client, reused (rebuilt only if the active key changes).
        self._client = None
        self._client_key: Optional[str] = None
        self._client_lock = threading.Lock()

    # ---------- reference image ----------
    def load_reference(self, ref_dir: Path):
        exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".jfif"}
        for f in sorted(ref_dir.iterdir()):
            if f.suffix.lower() in exts:
                img = Image.open(f).convert("RGB")
                w, h = img.size
                # Resize to 256×256 to minimize input tokens
                img = img.resize((REFERENCE_MAX_DIM, REFERENCE_MAX_DIM), Image.LANCZOS)
                self._ref_image = img
                logger.info(
                    f"Reference image loaded: {f.name}  "
                    f"(original {w}×{h} → {REFERENCE_MAX_DIM}×{REFERENCE_MAX_DIM})"
                )
                return
        raise FileNotFoundError(f"No image found in {ref_dir}")

    # ---------- key management ----------
    def _get_key(self) -> str:
        with self._key_lock:
            return self._active_key

    def switch_to_backup(self) -> bool:
        with self._key_lock:
            if self.backup_key and self._active_key != self.backup_key:
                self._active_key = self.backup_key
                logger.warning("Switched to BACKUP API key")
                return True
        return False

    # ---------- budget check ----------
    def _check_budget(self):
        """Raise if budget exhausted."""
        if MAX_API_CALLS > 0 and self._api_calls >= MAX_API_CALLS:
            raise RuntimeError(
                f"BUDGET CAP REACHED: {self._api_calls}/{MAX_API_CALLS} API calls used. "
                f"Increase MAX_API_CALLS in main.py to continue."
            )

    # ---------- SDK client (express mode) ----------
    def _get_client(self):
        from google import genai
        key = self._get_key()
        with self._client_lock:
            if self._client is None or self._client_key != key:
                # vertexai=True + api_key  ->  Vertex AI express mode.
                from google.genai import types as _types
                self._client = genai.Client(
                    vertexai=True,
                    api_key=key,
                    http_options=_types.HttpOptions(timeout=API_TIMEOUT * 1000),
                )
                self._client_key = key
                logger.info("  Built Vertex AI express-mode client")
            return self._client

    # ---------- adaptive pacing ----------
    def _pace(self):
        """Block until this thread is allowed to make its call."""
        while True:
            with self._pace_lock:
                now = time.time()
                if now >= self._next_allowed:
                    self._next_allowed = now + self._delay
                    return
                wait = self._next_allowed - now
            time.sleep(min(wait, 5.0))

    def _on_rate_limit(self):
        """429 seen -> slow everything down."""
        with self._pace_lock:
            self._delay = min(self._delay * RATE_GROW, RATE_MAX_DELAY)
            # Push the next slot out so other threads don't pile straight in.
            self._next_allowed = max(self._next_allowed, time.time() + self._delay)

    def _on_success(self):
        """Call went through -> creep back toward a faster pace."""
        with self._pace_lock:
            self._delay = max(self._delay * RATE_SHRINK, RATE_MIN_DELAY)

    def _increment_calls(self):
        with self._api_lock:
            self._last_call_time = time.time()
            self._api_calls += 1
            return self._api_calls

    @property
    def api_calls_used(self) -> int:
        return self._api_calls

    # ---------- prompt builder (shared by standard + batch) ----------
    @staticmethod
    def build_prompt(item_name: str, description: str = "", category: str = "") -> str:
        """Build the image generation prompt for a menu item."""
        # Build context string from all available fields
        context_parts = [f'"{item_name}"']
        if category:
            context_parts.append(f'Category: {category}')
        if description:
            context_parts.append(f'Description: {description}')
        dish_context = ". ".join(context_parts)

        return (
            f"A professional food photograph of \"{item_name}\". "
            f"DISH CONTEXT: {dish_context}. "
            f"Use the above context (name, category, and description) to accurately represent the dish — "
            f"its ingredients, plating style, and cuisine type. "
            f"FIXED STYLE: Match the exact photography style of the reference image. "
            f"Strictly maintain the 45-degree camera angle, the bright directional lighting with distinct shadows, "
            f"the textured light stone surface, the dark wooden baseboard, and the solid pale green background. "
            f"ADAPTIVE VESSEL: Do NOT copy the copper kadhai from the reference. Instead, smartly serve the \"{item_name}\" "
            f"in a vessel that logically suits the dish (e.g., a deep ceramic bowl for soups, a flat plate for rice, "
            f"a small bowl for ice cream, or a traditional dish for curries). Ensure the vessel's design matches "
            f"the premium, earthy aesthetic of the scene. "
            f"ADAPTIVE PROPS: Do NOT copy the spice bowl with red chilies. Instead, place a subtle background prop "
            f"or ingredient bowl that contextually matches the specific cuisine and recipe of \"{item_name}\". "
            f"The image must be perfectly square (1:1 aspect ratio)."
        )

    # ---------- reference image → raw JPEG bytes ----------
    def ref_jpeg_bytes(self) -> bytes:
        """Reference image as JPEG bytes (cached)."""
        if self._ref_image is None:
            raise RuntimeError("Reference image not loaded")
        if self._ref_jpeg is None:
            buf = BytesIO()
            self._ref_image.save(buf, format="JPEG", quality=90)
            self._ref_jpeg = buf.getvalue()
        return self._ref_jpeg

    # ---------- fallback prompts (used when a prompt gets blocked) ----------
    @staticmethod
    def _fallback_prompt(item_name: str, description: str, category: str, attempt: int) -> str:
        """Progressively plainer prompts. A blocked prompt rarely unblocks itself."""
        if attempt == 0:
            return (
                f"A professional food photograph of \"{item_name}\". "
                f"Match the photography style, lighting, surface and pale green background "
                f"of the reference image. Serve the dish in a vessel that suits it. "
                f"Square 1:1 composition."
            )
        if attempt == 1:
            ctx = f" ({category})" if category else ""
            return (
                f"Professional food photography of {item_name}{ctx}, 45-degree angle, "
                f"bright directional lighting, light stone surface, pale green background, "
                f"square composition."
            )
        return f"A appetizing photo of {item_name} on a plate, plain pale background."

    # ---------- generate ----------
    def generate(self, item_name: str, description: str = "", category: str = "") -> bytes:
        """Generate a food image via Vertex AI express mode. Returns JPEG bytes. Thread-safe."""
        if self._ref_image is None:
            raise RuntimeError("Reference image not loaded")

        # Budget guard — fail BEFORE spending a call.
        self._check_budget()

        from google.genai import types

        prompt = self.build_prompt(item_name, description, category)
        ref_part = types.Part.from_bytes(
            data=self.ref_jpeg_bytes(), mime_type="image/jpeg"
        )
        config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(
                aspect_ratio=ASPECT_RATIO,
                image_size=IMAGE_SIZE,
            ),
        )

        last_err = "unknown error"
        blocked_count = 0

        for attempt in range(MAX_RETRIES + 1):
            # Global pacing — blocks until this thread is cleared to call.
            self._pace()
            self._check_budget()
            count = self._increment_calls()
            logger.info(
                f"  API call #{count} '{item_name}' "
                f"[try {attempt + 1}/{MAX_RETRIES + 1}, pace {self._delay:.0f}s, "
                f"budget {MAX_API_CALLS or 'inf'}]"
            )

            try:
                resp = self._get_client().models.generate_content(
                    model=MODEL_NAME,
                    contents=[ref_part, prompt],
                    config=config,
                )
            except Exception as e:
                msg = str(e)
                last_err = f"{type(e).__name__}: {msg[:300]}"

                if _is_rate_limit(msg):
                    self._on_rate_limit()
                    wait = min(RATE_BACKOFF_BASE * (2 ** attempt), RATE_BACKOFF_MAX)
                    logger.warning(
                        f"  [429] quota exhausted — sleeping {wait:.0f}s "
                        f"(pace raised to {self._delay:.0f}s)"
                    )
                    time.sleep(wait)
                    continue

                if _is_auth_error(msg):
                    logger.error(f"  [AUTH] {msg[:250]}")
                    if self.switch_to_backup():
                        continue
                    # Nothing left to try — this is fatal for every item.
                    raise RuntimeError(f"AUTH/BILLING FAILURE: {msg[:300]}")

                wait = min(5 * (2 ** attempt), 60)
                logger.warning(f"  [ERR] {last_err} — retry in {wait:.0f}s")
                time.sleep(wait)
                continue

            # ---- got a response: pull the image out ----
            raw = _extract_image_bytes(resp)
            if raw:
                self._on_success()
                return self._to_jpeg_256(raw)

            # Response arrived but carried no image (safety block / text-only).
            self._on_success()  # the call itself was accepted; don't slow the pace
            reason = _finish_reason(resp)
            try:
                text = (resp.text or "")[:160]
            except Exception:
                text = ""
            last_err = f"no image (finish_reason={reason}, text={text!r})"
            logger.warning(f"  [NO IMAGE] {last_err}")

            prompt = self._fallback_prompt(item_name, description, category, blocked_count)
            blocked_count += 1
            time.sleep(2)

        raise RuntimeError(
            f"Failed after {MAX_RETRIES + 1} attempts for '{item_name}': {last_err}"
        )

    # ---------- resize to 256×256 JPEG (no iterative compression) ----------
    @staticmethod
    def _to_jpeg_256(raw_bytes: bytes) -> bytes:
        """Resize to 256×256 JPEG. One-shot, no loops, no waste."""
        img = Image.open(BytesIO(raw_bytes)).convert("RGB")
        img = img.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return buf.getvalue()

    # ---------- reference image → base64 (for batch JSONL) ----------
    def ref_to_base64(self) -> str:
        """Convert reference image to base64 JPEG for batch API payloads."""
        if self._ref_image is None:
            raise RuntimeError("Reference image not loaded")
        buf = BytesIO()
        self._ref_image.save(buf, format="JPEG", quality=85)
        return base64.b64encode(buf.getvalue()).decode("ascii")




# ════════════════════════════════════════════════════════════
# GOOGLE DRIVE UPLOADER  (optional)
# ════════════════════════════════════════════════════════════

class DriveUploader:
    SCOPES = ["https://www.googleapis.com/auth/drive.file"]

    def __init__(self):
        self.service = None
        self.enabled = False

    def authenticate(self) -> bool:
        client_secrets = CREDENTIALS_DIR / "credentials.json"
        token_file = CREDENTIALS_DIR / "token.json"

        if not client_secrets.exists():
            logger.info(
                "Google Drive credentials not found — Drive upload disabled. "
                "See README.md for setup."
            )
            return False

        try:
            from google.oauth2.credentials import Credentials
            from google_auth_oauthlib.flow import InstalledAppFlow
            from google.auth.transport.requests import Request
            from googleapiclient.discovery import build

            creds = None
            if token_file.exists():
                creds = Credentials.from_authorized_user_file(
                    str(token_file), self.SCOPES
                )

            if not creds or not creds.valid:
                if creds and creds.expired and creds.refresh_token:
                    creds.refresh(Request())
                else:
                    flow = InstalledAppFlow.from_client_secrets_file(
                        str(client_secrets), self.SCOPES
                    )
                    creds = flow.run_local_server(port=0)
                with open(token_file, "w") as f:
                    f.write(creds.to_json())

            self.service = build("drive", "v3", credentials=creds)
            self.enabled = True
            logger.info("Google Drive authenticated ✓")
            return True

        except Exception as e:
            logger.warning(f"Google Drive auth failed: {e}")
            return False

    def upload(self, image_bytes: bytes, filename: str) -> str:
        if not self.enabled or not self.service:
            return ""
        try:
            from googleapiclient.http import MediaIoBaseUpload

            media = MediaIoBaseUpload(BytesIO(image_bytes), mimetype="image/jpeg")
            meta = {"name": filename, "parents": [DRIVE_FOLDER_ID]}
            f = (
                self.service.files()
                .create(body=meta, media_body=media, fields="id")
                .execute()
            )
            return f.get("id", "")
        except Exception as e:
            logger.warning(f"Drive upload failed for {filename}: {e}")
            return ""


# ════════════════════════════════════════════════════════════
# PIPELINE
# ════════════════════════════════════════════════════════════

class Pipeline:
    def __init__(self):
        self._abort = False          # set on fatal auth/billing failure
        self._imgbb_capped = False   # set when imgbb starts refusing all uploads
        self.progress = ProgressTracker(PROGRESS_FILE)
        self.generator = ImageGenerator(GEMINI_API_KEY, GEMINI_BACKUP_KEY)
        self.drive = DriveUploader()
        self.excel = ExcelHandler()
        self.excel_path: Optional[Path] = None

    # ---- setup ----
    def setup(self):
        for d in (REFERENCE_DIR, INPUT_DIR, OUTPUT_DIR, IMAGES_DIR, CREDENTIALS_DIR):
            d.mkdir(parents=True, exist_ok=True)

        acquire_single_instance_lock()

        if not GEMINI_API_KEY:
            console.print("[bold red]✗ GEMINI_API_KEY not set in .env[/]")
            sys.exit(1)

        # Reference image
        self.generator.load_reference(REFERENCE_DIR)

        # Excel — same choice every stage of the pipeline makes (see menu_source.py)
        self.excel_path, why = pick_input_excel(INPUT_DIR)
        if self.excel_path is None:
            console.print(
                f"[bold red]✗ {why}[/]\n"
                "  Drop your Excel file there, or run [bold]python extract_menu.py[/] "
                "to build one from menu photos."
            )
            sys.exit(1)
        console.print(f"[dim]  using {self.excel_path.name} ({why})[/]")

        # Drive (optional)
        self.drive.authenticate()

    # ---- process single item ----
    @staticmethod
    def _link_for(result: Dict) -> str:
        """Best link for the Excel: public imgbb URL > Drive URL > local path."""
        hosted = result.get("imgbb_url")
        if hosted:
            return hosted
        drive_id = result.get("drive_id")
        if drive_id:
            return f"https://drive.google.com/uc?export=view&id={drive_id}"
        return result.get("local", "")

    def _process_one(self, item: Dict) -> Dict:
        key = f"{item['row']}_{item['item_name']}"
        name = item["item_name"]

        # A fatal auth/billing error already happened — stop burning items.
        if self._abort:
            return item

        # Already done? Re-attach its link so a resumed run still fills the Excel.
        if self.progress.is_done(key):
            item["postimage_url"] = self._link_for(self.progress.get_result(key) or {})
            return item

        safe = "".join(c if c.isalnum() or c in "- " else "_" for c in name)
        filename = f"{item['row']:04d}_{safe}.jpg"
        local = IMAGES_DIR / filename

        # ── GENERATE (only ONCE — never re-generate) ──
        if local.exists() and local.stat().st_size > 0:
            logger.info(f"  Reusing local image: {filename}")
            result = {"local": str(local)}
            self.progress.mark_done(key, result)
            item["postimage_url"] = self._link_for(result)
            return item

        try:
            logger.info(f"  Generating: {name}")
            jpeg = self.generator.generate(name, item.get("description", ""), item.get("category", ""))
            size_kb = len(jpeg) / 1024
            logger.info(f"  → {OUTPUT_SIZE}×{OUTPUT_SIZE} JPEG: {size_kb:.1f} KB")

            # Save locally
            with open(local, "wb") as f:
                f.write(jpeg)

            # Drive upload (optional, non-blocking)
            drive_id = self.drive.upload(jpeg, filename)

            # imgbb upload (optional) — gives the Excel a public, hotlinkable URL.
            # Never fatal: a hosting hiccup must not lose a generated image.
            imgbb_url = ""
            if IMGBB_ENABLED and not self._imgbb_capped:
                try:
                    imgbb_url = imgbb.upload(local)
                    logger.info(f"  uploaded -> {imgbb_url}")
                except imgbb.ImgbbUploadCap as e:
                    # Every further upload this run would fail identically.
                    # Keep generating — hosting is a separate, re-runnable stage.
                    self._imgbb_capped = True
                    logger.warning(f"  imgbb upload cap hit: {e}")
                    console.print(
                        "\n[yellow]⚠ imgbb is refusing new uploads for this API key.[/]\n"
                        "[yellow]  Images are still being generated and saved locally.[/]\n"
                        "[yellow]  Host them later with: [bold]python host_images.py[/][/]\n"
                    )
                except Exception as e:
                    logger.warning(f"  imgbb upload failed for {filename}: {e}")

            result = {"local": str(local), "drive_id": drive_id,
                      "imgbb_url": imgbb_url, "kb": round(size_kb, 1)}
            self.progress.mark_done(key, result)
            item["postimage_url"] = self._link_for(result)
            return item

        except RuntimeError as e:
            if "AUTH/BILLING FAILURE" in str(e):
                # The key/project itself is broken — every remaining item would
                # fail identically. Stop now instead of logging 55 identical errors.
                self._abort = True
                self.progress.mark_failed(key, str(e))
                logger.error("  ABORTING RUN — API key or billing is not usable")
                raise
            if "BUDGET CAP" in str(e):
                raise
            logger.error(f"  ✗ Failed: {e}")
            self.progress.mark_failed(key, str(e))
            return item
        except Exception as e:
            err = str(e)
            logger.error(f"  ✗ Failed: {err}")
            if "429" in err or "quota" in err.lower() or "rate" in err.lower():
                self.generator.switch_to_backup()
            self.progress.mark_failed(key, err)
            return item

    # ---- run ----
    def run(self):
        t0 = time.time()

        # --- header ---
        console.print(
            Panel(
                "[bold white]RESTAURANT MENU IMAGE AUTOMATION[/]",
                border_style="bright_cyan",
                padding=(1, 4),
            )
        )

        self.setup()
        items = self.excel.read_items(self.excel_path)

        # Apply test limit
        if TEST_LIMIT > 0:
            items = items[:TEST_LIMIT]
            console.print(
                f"[bold yellow]⚡ TEST MODE: Processing first {TEST_LIMIT} items only. "
                f"Set TEST_LIMIT = 0 in main.py to run all.[/]\n"
            )

        total = len(items)
        already = sum(
            1
            for it in items
            if self.progress.is_done(f"{it['row']}_{it['item_name']}")
        )
        remaining = total - already

        info = Table.grid(padding=(0, 2))
        info.add_row("📋 Excel", f"[cyan]{self.excel_path.name}[/]")
        info.add_row("🖼  Reference", f"[cyan]{REFERENCE_DIR}[/]")
        info.add_row("📦 Total items", f"[bold]{total}[/]")
        info.add_row("✅ Already done", f"[green]{already}[/]")
        info.add_row("🔄 Remaining", f"[yellow]{remaining}[/]")
        info.add_row("⚡ Workers", f"[bold]{MAX_WORKERS}[/]")
        info.add_row(
            "☁  Drive upload",
            "[green]enabled[/]" if self.drive.enabled else "[dim]disabled[/]",
        )
        console.print(info)
        console.print()

        if remaining == 0:
            console.print("[green]✓ All items already processed![/]")
        else:
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(bar_width=40),
                TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
                TextColumn("({task.completed}/{task.total})"),
                TimeElapsedColumn(),
                TimeRemainingColumn(),
                console=console,
            ) as progress:
                task_id = progress.add_task("Generating images", total=total)

                # Advance for already-done items immediately
                if already > 0:
                    progress.advance(task_id, advance=already)

                with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
                    futures = {
                        pool.submit(self._process_one, it): it for it in items
                    }
                    for future in as_completed(futures):
                        it = futures[future]
                        try:
                            future.result()
                        except Exception as e:
                            logger.error(f"Unexpected: {e}")
                        # Only advance for items that weren't already done
                        key = f"{it['row']}_{it['item_name']}"
                        if not self.progress.is_done(key) or key not in {
                            f"{x['row']}_{x['item_name']}" for x in items[:already]
                        }:
                            progress.advance(task_id)

        # --- write output Excel ---
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_name = f"output_{self.excel_path.stem}_{ts}.xlsx"
        out_path = OUTPUT_DIR / out_name
        self.excel.write_output(self.excel_path, items, out_path)

        # --- summary ---
        elapsed = time.time() - t0
        done_count = len(self.progress.data["completed"])
        fail_count = len(self.progress.data["failed"])

        console.print()
        summary = Table.grid(padding=(0, 2))
        summary.add_row("✅ Completed", f"[green bold]{done_count}[/]")
        summary.add_row("❌ Failed", f"[red bold]{fail_count}[/]" if fail_count else "[green]0[/]")
        summary.add_row("⏱  Time", f"[cyan]{elapsed/60:.1f} min[/]")
        summary.add_row("📄 Output", f"[bold]{out_path}[/]")
        console.print(
            Panel(summary, title="[bold]Pipeline Complete[/]", border_style="green")
        )

        if fail_count:
            console.print("\n[bold red]Failed items:[/]")
            for k, info in self.progress.data["failed"].items():
                console.print(f"  • {k}: [dim]{info['error'][:80]}[/]")
            console.print(
                "\n[yellow]Tip: Run again to retry only failed items.[/]"
            )

    # ---- batch mode ----
    def run_batch(self):
        """Run pipeline using Batch API (50% cheaper, async processing)."""
        # Batch API needs Files/GCS + full project credentials. Express-mode
        # keys (AQ.*) cannot drive it — refuse loudly rather than fail obscurely.
        if (GEMINI_API_KEY or "").startswith("AQ."):
            console.print(
                "[bold red]✗ Batch mode is not available with a Vertex AI "
                "express-mode key.[/]"
            )
            console.print("  Run [bold]python main.py[/] (normal mode) instead.")
            sys.exit(1)
        t0 = time.time()

        console.print(
            Panel(
                "[bold white]RESTAURANT MENU IMAGE AUTOMATION[/]\n"
                "[bold yellow]⚡ BATCH MODE — 50% cheaper[/]",
                border_style="bright_cyan",
                padding=(1, 4),
            )
        )

        self.setup()
        items = self.excel.read_items(self.excel_path)

        if TEST_LIMIT > 0:
            items = items[:TEST_LIMIT]
            console.print(
                f"[bold yellow]⚡ TEST MODE: Processing first {TEST_LIMIT} items only.[/]\n"
            )

        total = len(items)
        pending = [
            it for it in items
            if not self.progress.is_done(f"{it['row']}_{it['item_name']}")
        ]
        already = total - len(pending)

        info = Table.grid(padding=(0, 2))
        info.add_row("📋 Excel", f"[cyan]{self.excel_path.name}[/]")
        info.add_row("📦 Total items", f"[bold]{total}[/]")
        info.add_row("✅ Already done", f"[green]{already}[/]")
        info.add_row("🔄 Remaining", f"[yellow]{len(pending)}[/]")
        info.add_row("🔋 Mode", "[bold green]BATCH (50% discount)[/]")
        console.print(info)
        console.print()

        if not pending:
            console.print("[green]✓ All items already processed![/]")
        else:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.generator._get_key())

            # ── Check for resumable batch job ──
            batch_state = self.progress.data.get("batch_job")
            job_name = None

            if batch_state and batch_state.get("job_name"):
                job_name = batch_state["job_name"]
                console.print(f"[cyan]↻ Resuming batch job: {job_name}[/]\n")
            else:
                # ── Build JSONL ──
                console.print("[dim]Building batch request file...[/]")
                ref_b64 = self.generator.ref_to_base64()
                jsonl_path = OUTPUT_DIR / "batch_requests.jsonl"

                with open(jsonl_path, "w", encoding="utf-8") as f:
                    for item in pending:
                        prompt = ImageGenerator.build_prompt(item["item_name"], item.get("description", ""), item.get("category", ""))
                        req = {
                            "key": str(item["row"]),
                            "request": {
                                "contents": [{
                                    "parts": [
                                        {"text": prompt},
                                        {"inlineData": {
                                            "mimeType": "image/jpeg",
                                            "data": ref_b64,
                                        }},
                                    ]
                                }],
                                "generation_config": {
                                    "responseModalities": ["IMAGE"],
                                },
                            },
                        }
                        f.write(json.dumps(req) + "\n")

                jsonl_kb = jsonl_path.stat().st_size / 1024
                console.print(
                    f"[dim]  JSONL: {jsonl_kb:.1f} KB  ({len(pending)} requests)[/]"
                )

                # ── Upload JSONL ──
                console.print("[dim]Uploading to Gemini...[/]")
                uploaded = client.files.upload(
                    file=str(jsonl_path),
                    config=types.UploadFileConfig(
                        display_name="menu-batch-requests",
                        mime_type="jsonl",
                    ),
                )
                logger.info(f"Uploaded batch file: {uploaded.name}")

                # ── Create batch job ──
                console.print("[dim]Creating batch job...[/]")
                batch_job = client.batches.create(
                    model=MODEL_NAME,
                    src=uploaded.name,
                    config={
                        "display_name": f"menu-{datetime.now().strftime('%Y%m%d_%H%M%S')}",
                    },
                )
                job_name = batch_job.name
                logger.info(f"Batch job created: {job_name}")
                console.print(f"[green]✓ Batch job submitted: {job_name}[/]\n")

                # Save job name for resume
                with self.progress._lock:
                    self.progress.data["batch_job"] = {
                        "job_name": job_name,
                        "pending_count": len(pending),
                        "submitted_at": datetime.now().isoformat(),
                    }
                    self.progress._save()

            # ── Poll until complete ──
            completed_states = {
                "JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED",
                "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED",
            }

            batch_job = client.batches.get(name=job_name)

            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                TimeElapsedColumn(),
                console=console,
            ) as prog:
                task_id = prog.add_task("Waiting for batch...", total=None)
                while batch_job.state.name not in completed_states:
                    prog.update(
                        task_id,
                        description=f"Batch status: [cyan]{batch_job.state.name}[/]",
                    )
                    time.sleep(15)
                    batch_job = client.batches.get(name=job_name)

            console.print(f"\n[bold]Batch finished: {batch_job.state.name}[/]")

            if batch_job.state.name != "JOB_STATE_SUCCEEDED":
                console.print(
                    f"[bold red]✗ Batch failed: {batch_job.state.name}[/]"
                )
                if hasattr(batch_job, "error") and batch_job.error:
                    console.print(f"[red]  {batch_job.error}[/]")
                return

            # ── Download and process results ──
            console.print("[dim]Downloading results...[/]")
            result_bytes = client.files.download(file=batch_job.dest.file_name)
            result_text = result_bytes.decode("utf-8")

            row_to_item = {str(it["row"]): it for it in pending}
            success_count = 0
            fail_count = 0

            for line in result_text.splitlines():
                if not line.strip():
                    continue
                parsed = json.loads(line)
                row_key = parsed.get("key", "")
                item = row_to_item.get(row_key)
                if not item:
                    logger.warning(f"Unknown batch result key: {row_key}")
                    continue

                progress_key = f"{item['row']}_{item['item_name']}"

                if "error" in parsed:
                    self.progress.mark_failed(progress_key, str(parsed["error"]))
                    fail_count += 1
                    continue

                try:
                    parts = parsed["response"]["candidates"][0]["content"]["parts"]
                    image_data = None
                    for part in parts:
                        if part.get("inlineData"):
                            image_data = base64.b64decode(
                                part["inlineData"]["data"]
                            )
                            break

                    if not image_data:
                        raise ValueError("No image data in batch response")

                    jpeg = ImageGenerator._to_jpeg_256(image_data)
                    safe = "".join(
                        c if c.isalnum() or c in "- " else "_"
                        for c in item["item_name"]
                    )
                    filename = f"{item['row']:04d}_{safe}.jpg"
                    local = IMAGES_DIR / filename

                    with open(local, "wb") as f_img:
                        f_img.write(jpeg)

                    size_kb = len(jpeg) / 1024
                    self.progress.mark_done(progress_key, {
                        "local": str(local),
                        "kb": round(size_kb, 1),
                    })
                    success_count += 1
                    logger.info(
                        f"  ✓ {item['item_name']} → {filename} ({size_kb:.1f} KB)"
                    )

                except Exception as e:
                    self.progress.mark_failed(progress_key, str(e))
                    fail_count += 1
                    logger.error(f"  ✗ {item['item_name']}: {e}")

            # Clear batch state
            with self.progress._lock:
                self.progress.data.pop("batch_job", None)
                self.progress._save()

            console.print(
                f"\n[green]✓ Processed: {success_count}[/]  "
                f"[red]✗ Failed: {fail_count}[/]"
            )

        # ── Write output Excel ──
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_name = f"output_{self.excel_path.stem}_{ts}.xlsx"
        out_path = OUTPUT_DIR / out_name
        self.excel.write_output(self.excel_path, items, out_path)

        # ── Summary ──
        elapsed = time.time() - t0
        done_count = len(self.progress.data["completed"])
        fail_count_total = len(self.progress.data["failed"])

        console.print()
        summary = Table.grid(padding=(0, 2))
        summary.add_row("✅ Completed", f"[green bold]{done_count}[/]")
        summary.add_row(
            "❌ Failed",
            f"[red bold]{fail_count_total}[/]" if fail_count_total else "[green]0[/]",
        )
        summary.add_row("⏱  Time", f"[cyan]{elapsed/60:.1f} min[/]")
        summary.add_row("📄 Output", f"[bold]{out_path}[/]")
        summary.add_row("💰 Mode", "[bold green]BATCH (50% savings)[/]")
        console.print(
            Panel(summary, title="[bold]Pipeline Complete[/]", border_style="green")
        )

        if fail_count_total:
            console.print("\n[bold red]Failed items:[/]")
            for k, finfo in self.progress.data["failed"].items():
                console.print(f"  • {k}: [dim]{finfo['error'][:80]}[/]")
            console.print(
                "\n[yellow]Tip: Run again with --batch to retry failed items.[/]"
            )


# ════════════════════════════════════════════════════════════
# ENTRY POINT
# ════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Restaurant Menu Image Automation"
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        help="Use Batch API (50%% cheaper, async — results in minutes/hours)",
    )
    args = parser.parse_args()

    try:
        pipeline = Pipeline()
        if args.batch:
            pipeline.run_batch()
        else:
            pipeline.run()
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted — progress saved. Run again to resume.[/]")
    except FileNotFoundError as e:
        console.print(f"\n[bold red]✗ {e}[/]")
        sys.exit(1)
    except Exception as e:
        console.print(f"\n[bold red]✗ Fatal error: {e}[/]")
        logger.exception("Fatal error")
        sys.exit(1)
