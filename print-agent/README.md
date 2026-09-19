# QuickVerse Print Agent (billing PC, Windows)

Silent helper so Chrome dashboard can auto-print without popup,
to the SAME USB printers PetPooja already uses.

## Why this
- Browsers block USB. This tiny app (no install wizard) sits on the billing PC,
  listens only on `http://127.0.0.1:1818`, and hands slips to the Windows
  printer queue by NAME — e.g. `EPSON TM-T82 Receipt`, `TVSE RP3200 Lite`.
- Windows lines up PetPooja + QuickVerse jobs one-after-other. No half-mix.
- Works offline for same-PC printing. No cloud needed for Phase 1.

## Setup (5 min, once per shop)
1. Install Node.js LTS on billing PC.
2. Copy this `print-agent` folder to `C:\QuickVerse\print-agent`.
3. Test with window (eyes open): run `start-agent.bat` — keep window open.
   Test: open `http://127.0.0.1:1818/status` in browser → `{"online":true}`.
4. Daily use — no black window: close the .bat, double-click
   `start-agent.vbs` instead (runs same server hidden in background).
   Auto-start: press Win+R → `shell:startup` → add shortcut to
   `start-agent.vbs`. Also disable USB selective suspend +
   Windows sleep in Power settings.
5. In QuickVerse Dashboard → Printer button → enter exact names from
   Windows Settings → Printers → Test Counter Print + Test Kitchen Print.
6. Enter GSTIN + FSSAI once — prints on every Counter Bill.

## API
- `GET /status` → `{online:true}`
- `POST /print` `{ "printer": "EPSON TM-T82 Receipt", "text": "80mm slip..." }`

## Tier-3 notes
- PC off / net gone: dashboard falls back to browser print window.
  Use Reprint on Accepted card after PC is back. Phase 2 adds backend
  queue so phone-accept also prints when PC comes online.
- Paper over / USB loose: Windows holds job in queue with error.
  Fix paper/cable → Reprint. No need to accept again.
- USB port renumber (USB001 → USB002): safe — we print by queue NAME,
  not port.
