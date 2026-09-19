# QuickVerse 200-shop rollout — v1.2.0 (Vercel HTTPS + proxy, ₹0)

## Deploy target: Vercel Hobby free
- Import `Lolxd-1/Vendor-Dashboard`, branch `experiment-loud-bell`, framework Vite.
- Build command: `tsc -b && vite build` (repo default). Output dir: `dist`.
- Env vars: `VITE_API_URL=""` (same-origin proxy), optional `VITE_REQUEST_OTP_URL`, `VITE_LOGIN_URL` only if backend moves auth paths.
- `vercel.json` proxies `/quickVerse/:path*` → `http://prd.quickverse.in/quickVerse/:path*` (server-side, no mixed content), SPA fallback last.
- Result: `https://<your-app>.vercel.app/` calls same-origin `/quickVerse/...`, Vercel fetches HTTP backend. PWA/SW active again (secure context). Print agent loopback covered by PNA header (v1.1.0+).

## What ships in v1.1.0
- Dashboard `dist/` works from any HTTP origin/subpath (`vite base "./"`, SW guarded to secure contexts only).
- Print agent v1.1.0: GDI Courier New 8pt monospace (42 cols = one line on TM-T82X 80mm), `GET /version`, PNA header for future HTTPS dashboard.
- Printer modal: auto-dropdown from `GET /printers`, defaults `EPSON TM-T82X Receipt` ×2 (single-printer pilot), version-mismatch warning.
- 2-min installer: `files/Install-QuickVerse.ps1` (printer check → agent copy → Task Scheduler + Startup fallback → verify → dashboard shortcut/policy/power → 42-col self-test).

## Per-shop 2-min flow (one guy)
```powershell
.\Install-QuickVerse.ps1 -SiteUrl "https://<your-app>.vercel.app/" -AddToStartup -NoSleep
```
HTTP-interim alternative (same-origin serve, no Vercel): `-SiteUrl "http://prd.quickverse.in/vendor/"`.
1. Driver: EPSON APD6 for TM-T82X, paper 80mm. Queue must appear in Settings → Printers.
2. Run installer (admin preferred). Note PASS lines: agent v1.1.0, queues listed, self-test printed.
3. Open QuickVerse shortcut → Printer → confirm queue → Single printer ticked → Save → Test Counter Print.
4. Gate: `123456789012...42` is ONE line, Bill columns aligned, no right-edge cut.

## Serve dashboard
- Primary: Vercel (above). Keep `VITE_API_URL=""` so all API goes through the proxy.
- Fallback (HTTP interim): copy `dist/*` to backend static at `http://prd.quickverse.in/vendor/` with `VITE_API_URL=http://prd.quickverse.in`.

## Scale order
Pilot 5 mixed shops → 20 → 200. Each gate: test-slip photo + live Bill+KOT + reboot auto-start + PetPooja FIFO check.

## Dual-printer later
Same modal: untick Single printer, set Kitchen to 2nd queue, Save. No reinstall.

## HTTPS cutover (later, no shop rework if on v1.1.0)
Backend: TLS + `X-Forwarded-Proto`, CORS allow `https://vendor.*`, `wss://`. Then flip `VITE_API_URL=https://...`, move frontend to Cloudflare Pages HTTPS. Agent already sends `Access-Control-Allow-Private-Network: true`.

## Diagnostics
- Agent: `http://127.0.0.1:1818/status` → `{online:true, version:"1.1.0"}`, `/printers` lists queues.
- Paper over/USB loose: Windows holds job → fix → Reprint on Accepted card. USB renumber safe (print by NAME).
