# Order Alert System

Everything needed to make vendor order alerts ring reliably, and to know when
they don't.

**Start with [GUIDE.md](GUIDE.md).** It explains the root cause and the full
fix. The files below are the implementation of what it describes.

```
GUIDE.md                             the complete guide — read this first
│
├── app/
│   ├── order-alert.js               browser audio engine (Layer 1)
│   └── escalation.js                server-side SMS/call ladder (Layer 4)
│
├── desktop/
│   ├── main.js                      Electron wrapper (Layer 3)
│   ├── preload.js                   shell ↔ dashboard bridge
│   └── README.md                    packaging and wiring
│
└── deploy/
    ├── Install-VendorDashboard.ps1  one-shot vendor machine setup (Layer 2)
    ├── enable-order-alert-autoplay.reg
    ├── remove-order-alert-autoplay.reg
    └── VENDOR-SETUP.md              plain-language doc to send to vendors
```

## The problem in one paragraph

Browsers refuse to play audible sound on a page that has not received a user
interaction. When an order arrives and the dashboard calls `play()`, the
browser rejects it, so the app shows "please turn on sound" — which only
works if the vendor is already looking at the screen, which is what the sound
was supposed to achieve. The fix is to take the interaction at **login**,
when the vendor is clicking anyway. Audio unlocked at login stays unlocked for
the whole session.

## Order of work

| | Layer | Why this order |
|---|---|---|
| 1 | `app/order-alert.js` | Cheapest fix, removes most of the pain |
| 2 | `app/escalation.js` | The actual safety net. Works when the PC is off. |
| 3 | `deploy/` | Removes the restriction on machines you control |
| 4 | `desktop/` | Where you end up. Problem stops existing. |

Layers 1–3 assume the computer is on, awake, connected, and has working
speakers. Layer 2 is what saves the order when it isn't. Do not skip it.

## Before anything else

Confirm the dashboard is served over **HTTPS with a valid certificate**.
Web Audio, service workers, notifications, and wake lock all require a secure
context. Nothing here works without it.
