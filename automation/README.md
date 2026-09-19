# 🍽️ Menu Photos → SmartBiz Catalogue

Drop photographs of a restaurant's menu into one folder. Get back a SmartBiz
bulk-upload sheet with a generated food image for every dish.

```
python run_all.py
```

---

## The cycle

```
input/Menu Images/*.jpg          ← the only thing you provide
      │
      │  1. extract_menu.py      read the boards with Gemini vision
      ▼
input/menu_items.xlsx            Item Name | Category | Price | Description
      │
      │  2. main.py              generate a food photo per item
      ▼
output/images/*.jpg
      │
      │  3. host_images.py       turn each image into a public URL
      ▼
public https://i.ibb.co/… links
      │
      │  4. smartbiz_export.py   fill the real SmartBiz template
      ▼
output/smartbiz_upload_<ts>.xlsx ← upload this to SmartBiz
```

**Every stage resumes.** Stop it, lose the internet, close the laptop — run it
again and it continues from where it stopped without re-spending a single API
call on work already done.

---

## Quick start

```bash
pip install -r requirements.txt

# 1. put your menu photographs here
#      input/Menu Images/
# 2. put one reference food photo here (defines the image style)
#      reference/
# 3. run
python run_all.py
```

### Useful variants

| Command | What it does |
|---|---|
| `python run_all.py` | the whole cycle |
| `python run_all.py --review` | **stop after reading the menus** so you can check prices first |
| `python run_all.py --from generate` | skip extraction, resume image generation |
| `python run_all.py --from host` | just host the images and rebuild the sheet |
| `python run_all.py --from export` | just rebuild the SmartBiz sheet |
| `python run_all.py --all-items` | include rows that have no image yet |

`--review` is worth using the first time. Reading a photograph is very
accurate but not magic — glance at the prices before spending an hour of image
quota on them.

---

## Stage 1 — reading the menus

`extract_menu.py` sends each photo to **`gemini-2.5-flash`** with a strict JSON
schema and writes `input/menu_items.xlsx`.

Built for batches — ten photos is a normal run:

- one API call per photo, on a small thread pool (~15s for two photos)
- **cached by file content hash** in `output/menu_extract_cache.json`, so
  re-running is free and adding an 11th photo costs exactly one call
- **one unreadable photo is reported and skipped** — it never kills the run
- items that appear on two overlapping photos are **de-duplicated**
- a same-name/same-section item with two different prices is kept **and
  flagged** as a `PRICE CONFLICT` for you to check

What it handles:

| On the board | In the sheet |
|---|---|
| `Choco Brownie Sundae — Large 150 / Small 120` | two rows, `…(Large)` and `…(Small)` |
| `Honey Butter/Maple Butter — 100` | one row, name kept as printed |
| `Box of 4 / Chocoholic's — 350` under *Mini Waff-wich Combos* | `Chocoholic's (Box of 4)`, category `Mini Waff-wich Combos` |
| small print under a dish | the `Description` column |
| allergen notices, GST lines, adjacent posters | ignored |

```bash
python extract_menu.py --dry-run    # see what it found, write nothing
python extract_menu.py --force      # ignore the cache, re-read every photo
python extract_menu.py --dir "path" # read photos from somewhere else
```

`Description` is not decoration — it is fed to the image generator as dish
context, so `Rocky Road` is drawn knowing it means *"chocolatey Waff-wich, milk
chococream, ice cream, nuts, oreos"*.

### Which sheet the pipeline uses

All four stages ask `menu_source.py`, so they can never disagree:

1. `$MENU_EXCEL` if set 2. `input/menu_items.xlsx` 3. the only `.xlsx` in
`input/` 4. the newest one, and it says so out loud.

---

## Stage 2 — generating the images

Unchanged from before: `main.py` generates one square food photo per row with
**`gemini-3.1-flash-lite-image`** on a Vertex AI express key, styled after the
image in `reference/`.

**This is the slow stage.** Express-mode free tier sustains roughly one image
per 30–90 seconds and rejects bursts with HTTP 429, so `MAX_WORKERS = 1` and
the pace self-tunes (×1.5 slower on every 429, ×0.92 faster on every success).
**Budget about an hour per 55 items.** Enabling billing on the express project
lifts the quota and the script speeds up on its own — no code change.

Every finished image is recorded in `output/progress.json`, so a re-run never
regenerates one.

---

## Stage 3 — hosting the images

SmartBiz needs a URL it can fetch, not a path on your laptop.
`host_images.py` uploads everything in `output/images/` that is not hosted yet
and records the public URL in `output/uploads.json`.

This is deliberately **separate** from image generation. Generating an image
costs real Gemini quota and takes a minute; hosting is free and instant. Tying
them together means an image-host outage throws away expensive work. Here the
images sit safely on disk and hosting can be retried as often as you like.

```bash
python host_images.py            # host everything pending
python host_images.py --status   # report only, upload nothing
```

### ⚠️ If imgbb returns "Internal upload error" (code 111)

That is an **account-level cap on your API key**, not a problem with your
images. Verified: a brand-new **692-byte** test image gets the same error, while
re-posting bytes imgbb has already stored still returns 200. Retrying harder
achieves nothing, so the stage stops immediately and tells you.

Your generated images are safe in `output/images/` — nothing needs
regenerating. Either wait for the cap to reset, or put a different
`IMGBB_API_KEY` in `.env`, then:

```bash
python run_all.py --from host
```

---

## Stage 4 — the SmartBiz sheet

`smartbiz_export.py` fills a **copy of the real template**
(`templates/smartbiz_template.xlsx`), so all 29 dropdowns and validation rules
SmartBiz expects survive. Building a lookalike sheet from scratch is what makes
these imports fail.

| Template column | Filled from |
|---|---|
| D Product Name | Item Name |
| E MRP | Price |
| G Business Category | `--business-category` (default `FOOD_AND_GROCERY`) |
| H Product Category | auto-mapped from the menu section |
| I Product Description | Description, else Category |
| P Product Image1 | the public image URL |

`SKU ID` / `Variant ID` are left blank on purpose — the template marks them
"Not to be Edited" and SmartBiz assigns them on import.

**Product Category is auto-mapped**, because a cold coffee is not a dessert.
Menu sections whose name *starts a word* with `shake`, `coffee`, `cooler`,
`juice`, `tea`, `lassi`, `soda`, `drink`, `smoothie`, `mocktail` or `beverage`
become **Beverages**; everything else keeps `--product-category` (default
*Chocolates, desserts and icecream*). The word-boundary test matters — a plain
substring match files **"Classics"** under Beverages, because `c‑LASSI‑cs`
contains "lassi".

Use `--no-auto-category` to force one category on every row.

By default only rows with a hosted image are exported; `--all` includes the
rest and warns per row.

---

## 🔑 API setup (Vertex AI express mode)

Image generation runs on **Vertex AI express mode**. Express keys start with
**`AQ.`** and are *not* interchangeable with old `AIza…` Gemini keys:

| Key format | Client call | Endpoint |
|---|---|---|
| `AIza…` | `genai.Client(api_key=…)` | `generativelanguage.googleapis.com` |
| `AQ.…` (this project) | `genai.Client(vertexai=True, api_key=…)` | `aiplatform.googleapis.com` |

The express key carries its own project binding — no project ID, no project
number, no `gcloud` login anywhere in the code.

```
# .env
GEMINI_API_KEY=AQ.your-express-key-here
GEMINI_BACKUP_KEY=
IMGBB_API_KEY=your-imgbb-key
```

Model notes:

- `gemini-3.1-flash-lite-image` supports **1024px output only** (`IMAGE_SIZE="2K"` → HTTP 400)
- `gemini-2.5-flash` is the vision model that reads the menus. The image model
  cannot read text back out, which is why stage 1 uses a different model.
- `python main.py --batch` is **not available** on an express key (the Batch API
  needs full project credentials). The script exits with a clear message.

---

## 🛡️ Failsafes

- **Single-instance lock** — two runs would share one quota and 429 each other
  into a standstill, so a second run refuses to start
- **9 attempts** per image with adaptive pacing and exponential backoff
- **Backup key auto-switch** on auth/billing failure, if one is configured
- **Fatal auth/billing errors abort immediately** instead of failing 56 items
  identically
- **imgbb caps stop the hosting stage cleanly** rather than failing image by image
- **Progress saved after every image** — crash-safe
- **Console forced to UTF-8** — Windows `cp1252` raises `UnicodeEncodeError` on
  the box-drawing and spinner glyphs otherwise
- **Previous `menu_items.xlsx` is backed up** to `output/backups/` before each
  overwrite, so hand-edits are never silently lost

---

## 📁 Project structure

```
Automation/
├── input/
│   ├── Menu Images/         ← DROP MENU PHOTOGRAPHS HERE
│   └── menu_items.xlsx      ← generated by stage 1
├── reference/               ← one photo defining the image style
├── output/
│   ├── images/              ← generated JPEGs
│   ├── backups/             ← previous menu_items.xlsx versions
│   ├── menu_extract_cache.json
│   ├── uploads.json         ← image → public URL
│   ├── progress.json        ← resume state
│   └── smartbiz_upload_*.xlsx   ← THE DELIVERABLE
├── templates/
│   └── smartbiz_template.xlsx
├── run_all.py               ← the whole cycle
├── extract_menu.py          ← stage 1
├── main.py                  ← stage 2
├── host_images.py           ← stage 3
├── smartbiz_export.py       ← stage 4
├── menu_source.py           ← which input sheet every stage uses
├── imgbb.py
└── .env                     ← API keys (DO NOT SHARE)
```

---

## ☁️ Google Drive upload (optional)

Images also go to a Drive folder if `credentials/credentials.json` (OAuth2
desktop-app credentials) exists and the Drive API is enabled. Without it,
images are still saved locally and imgbb URLs still go in the sheet.
