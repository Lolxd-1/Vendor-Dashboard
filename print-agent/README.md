# QuickVerse Print Agent v1.2.0 (billing PC, Windows — NO Node needed)

Silent helper so Chrome dashboard can auto-print without popup,
to the SAME USB printers PetPooja already uses.

Pure PowerShell (`agent.ps1`) — every Windows 10/11 runs it out of the box.
Old Node version (`server.js`) kept only as fallback.

## Why this
- Browsers block USB. This tiny script (no install wizard, no Node, no npm) sits
  on the billing PC, listens only on `http://127.0.0.1:1818`, and hands slips to
  the Windows printer queue by NAME — e.g. `EPSON TM-T82X Receipt`.
- Thermal queues print via GDI monospace (Courier New 8pt) so 42 columns = one
  line on 80mm. Windows lines up PetPooja + QuickVerse jobs one-after-other.
- Works offline for same-PC printing. No cloud needed for Phase 1.

## Setup (2 min, once per shop — or just run `Start-Setup.bat`)
1. Copy this `print-agent` folder to `C:\QuickVerse\print-agent`. (Nothing to install.)
2. Test with window (eyes open): run `start-agent.bat` — keep window open.
   Test: open `http://127.0.0.1:1818/status` in browser → `{"online":true,"version":"1.2.0"}`.
3. Daily use — no black window: close the .bat, double-click
   `start-agent.vbs` instead (runs same agent hidden in background).
   Auto-start: press Win+R → `shell:startup` → add shortcut to
   `start-agent.vbs`. Also disable USB selective suspend +
   Windows sleep in Power settings.
4. In QuickVerse Dashboard → Printer button → pick the queue from the dropdown
   (detected live from this agent) → Test Counter Print + Test Kitchen Print.
5. Enter GSTIN + FSSAI once — prints on every Counter Bill.

## API
- `GET /status` → `{online:true, version:"1.2.0"}`
- `GET /printers` → `{printers:[...]}`
- `POST /print` `{ "printer": "EPSON TM-T82X Receipt", "text": "80mm slip..." }`

## Tier-3 notes
- PC off / net gone: dashboard falls back to browser print window.
  Use Reprint on Accepted card after PC is back. Phase 2 adds backend
  queue so phone-accept also prints when PC comes online.
- Paper over / USB loose: Windows holds job in queue with error.
  Fix paper/cable → Reprint. No need to accept again.
- USB port renumber (USB001 → USB002): safe — we print by queue NAME,
  not port.
