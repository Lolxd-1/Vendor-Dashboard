# Making Order Alerts Actually Ring

**A complete guide to why your vendor dashboard doesn't make noise, and how to fix it permanently.**

Last verified: September 2026 against Chrome 149, Edge 151, Firefox 142, Electron 38.

---

## Table of contents

- [Part 0 — The short version](#part-0--the-short-version)
- [Part 1 — What is actually happening](#part-1--what-is-actually-happening)
- [Part 2 — Diagnosing it on a real vendor machine](#part-2--diagnosing-it-on-a-real-vendor-machine)
- [Part 3 — Layer 1: Arm the audio at login](#part-3--layer-1-arm-the-audio-at-login)
- [Part 4 — Layer 2: Remove the restriction on vendor machines](#part-4--layer-2-remove-the-restriction-on-vendor-machines)
- [Part 5 — Layer 3: Ship a desktop wrapper](#part-5--layer-3-ship-a-desktop-wrapper)
- [Part 6 — The delivery problem (your next bug)](#part-6--the-delivery-problem-your-next-bug)
- [Part 7 — The physical world](#part-7--the-physical-world)
- [Part 8 — The escalation ladder](#part-8--the-escalation-ladder)
- [Part 9 — Observability: knowing it's broken before the vendor calls](#part-9--observability-knowing-its-broken-before-the-vendor-calls)
- [Part 10 — Rollout plan](#part-10--rollout-plan)
- [Part 11 — Troubleshooting matrix](#part-11--troubleshooting-matrix)
- [Appendix A — Browser-by-browser reference](#appendix-a--browser-by-browser-reference)
- [Appendix B — Glossary](#appendix-b--glossary)

---

## Part 0 — The short version

Your dashboard is not broken. Browsers deliberately refuse to play audible sound on a page that has not received a genuine user interaction. When an order arrives and your code calls `play()`, the browser rejects it, and your app falls back to showing "please turn on the sound." The vendor clicks, sound starts, and the order has already been sitting there for ninety seconds.

The core insight is this: **the interaction does not have to happen when the order arrives. It only has to have happened at some point earlier in the page's life.** So you take it at login, when the vendor is clicking anyway. After that, every order for the rest of the shift rings with zero interaction.

That is the code fix, and it will get you from "broken" to "works for most vendors most of the time" in about a day.

To get to "works for every vendor every time," you stack three independent layers:

| Layer | What it does | Effort | Reliability |
|---|---|---|---|
| **1. Arm at login** | Unlocks audio using the login click | ~1 day | Good. Fails if vendor never logs in fresh, or page reloads unattended. |
| **2. Browser policy** | Removes the restriction on vendor machines entirely | ~2 days incl. rollout | Very good. Fails if vendor changes browser or reimages PC. |
| **3. Desktop wrapper** | Runs the dashboard as a native app with no autoplay policy at all | ~1 week | Excellent. This is where you want to end up. |
| **4. Out-of-band escalation** | SMS/voice call when nobody acknowledges | ~2 days | The only thing that works when the PC is off. Build this regardless. |

Layer 4 is not optional. Everything in layers 1–3 assumes the computer is on, awake, connected, and has working speakers. Layer 4 is what saves the order when it isn't.

Do them in this order: **1 → 4 → 2 → 3.** Layer 1 because it is cheap and fixes most of the pain. Layer 4 because it is the actual safety net. Then 2 and 3 to grind the failure rate down.

---

## Part 1 — What is actually happening

### 1.1 The autoplay policy

Since Chrome 66 (2018), Chrome has blocked media elements from playing audible sound without user interaction. In Chrome 71 the same policy was extended to the Web Audio API, which is what broke a lot of dashboards, games, and WebRTC apps that had previously been fine. Every other major browser has since shipped something equivalent — Edge inherits it from Chromium, Firefox has its own version, and Safari has had one since 2017.

The motivation was ad-driven autoplay video. The side effect is that every legitimate alerting product on the web — hospital monitoring, industrial SCADA dashboards, call centre queues, and order dashboards like yours — hit exactly the wall you are hitting. You are not doing anything wrong and there is no clever API you missed. This is a deliberate platform restriction and the only ways through it are the ones in this document.

### 1.2 The four gates

Chrome allows audible playback if **any one** of these is true:

1. **The media is muted.** Useless to you — a silent alarm is not an alarm.
2. **The user has interacted with the domain.** A click, tap, or key press inside the page. This is the gate you will use.
3. **The user's Media Engagement Index for your origin is high enough.** Desktop only.
4. **The site is installed as a PWA on desktop, or added to the home screen on mobile.** Installed web apps get autoplay for free.

Gate 3 deserves a warning, because it is the reason your bug is *intermittent* and therefore hard to believe.

### 1.3 Why it "works on my machine" — the MEI trap

The Media Engagement Index is a per-origin score Chrome keeps, measuring how much media a given user consumes on a given site. For a playback event to *count toward* the score, Chrome requires roughly: playback longer than seven seconds, audio present and unmuted, the tab active, and (for video) a player larger than 200x140 pixels. When the score is high enough, Chrome grants that origin autoplay permission automatically.

You can inspect it yourself at `chrome://media-engagement`.

Here is what this does to you:

- **On your dev machine**, you have loaded the dashboard hundreds of times and triggered the sound hundreds of times. Your MEI for that origin is high. Audio autoplays. You conclude the feature works.
- **On a fresh vendor machine**, MEI is zero. Audio is blocked. The vendor sees the popup.
- **On a vendor machine after two weeks of use**, MEI may have crept up enough to grant autoplay — so it starts working, and then one day the vendor clears browsing data, or you change your domain, or they get a new PC, and it silently stops again.

This is why you are certain "that is not an issue" — on the machines you test on, it genuinely isn't. **Never rely on MEI.** It is invisible, per-user, per-origin, resets with browsing data, is not available in Incognito, and short alert chimes are poorly suited to building it in the first place (a 2-second ring does not meet the seven-second threshold, and the tab is usually not active when it plays). Treat MEI as noise that makes your bug reports inconsistent, never as a mechanism.

### 1.4 Transient vs. sticky activation

Two different concepts get conflated constantly, and the difference is the whole trick.

**Transient activation** is a short-lived window — a few seconds — immediately following a user gesture. APIs that can pop up something intrusive (opening a window, entering fullscreen, requesting clipboard access) require transient activation and it expires quickly.

**Sticky activation** is a one-way flag on the document: "has this document *ever* received a user gesture?" Once true, it stays true for the lifetime of that document. You can read it in JS:

```js
navigator.userActivation.hasBeenActive  // sticky:  has the user ever interacted?
navigator.userActivation.isActive       // transient: did they interact just now?
```

Audio playback is gated on **sticky** activation, not transient. That is the entire basis of the fix. You do not need the vendor to click at the moment the order arrives. You need them to have clicked *once, ever,* on that page load. The login button is a click. That is your gesture.

### 1.5 What happens specifically with Web Audio

If you create an `AudioContext` before any interaction has occurred, it is created in the `suspended` state. Nothing plays. You must call `ctx.resume()`, and that call must originate from inside a user gesture handler to succeed. Once it resolves and `ctx.state === 'running'`, **the context stays running for the lifetime of the page.** You can start and stop as many sounds through it as you like, at any time, with no further interaction.

That is a stronger guarantee than you get from `<audio>` elements, which is the main reason this guide uses Web Audio throughout.

### 1.6 `<audio>` element vs. Web Audio API

| | `<audio>` element | Web Audio API |
|---|---|---|
| Unlock model | Each `play()` call is evaluated against the policy | One `resume()` unlocks the whole context permanently |
| Failure mode | `play()` returns a rejected Promise | `resume()` resolves but state stays `suspended` |
| Latency on first play | Has to buffer/decode on demand | Buffer is decoded once, held in memory, starts instantly |
| Gapless looping | `loop` attribute has audible seams in some browsers | Sample-accurate, seamless |
| Volume control | `.volume` property, 0–1 | GainNode, can ramp smoothly, can exceed 1 |
| Output device routing | `setSinkId()` on the element | `setSinkId()` on the AudioContext (Chrome 110+) |
| Survives network loss | Needs the file cached | Buffer already in RAM, no network needed |

**Use Web Audio.** The last row matters more than you would think: if the vendor's internet drops and then an order comes through on reconnect, an `<audio>` element pointed at `/sounds/ring.mp3` may fail to fetch. A decoded AudioBuffer sitting in memory cannot fail.

### 1.7 Why your current popup defeats the purpose

Your current flow is:

```
order arrives → try to play → browser blocks → show "enable sound" popup
→ vendor notices the popup visually (somehow) → vendor clicks → sound plays
```

Every step after "browser blocks" depends on the vendor **already looking at the screen**, which is exactly what the sound was supposed to achieve. It is circular. The popup can only ever be a diagnostic, never a mechanism.

The corrected flow is:

```
vendor logs in → click unlocks audio → status chip shows "Sound on"
→ [shift proceeds] → order arrives → rings immediately, loops until accepted
```

---

## Part 2 — Diagnosing it on a real vendor machine

Do this before you write any code, on an actual vendor PC or a fresh Windows VM with a clean Chrome profile. Twenty minutes here will save you a week.

### 2.1 Get a clean profile

Your own browser is contaminated by MEI and by site permissions you have granted over months. Test on a clean one:

```bat
:: Windows — launches Chrome with a brand new throwaway profile
"C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="%TEMP%\clean-chrome-test"
```

Do **not** use Incognito for this test. Incognito has different MEI and permission behaviour and will give you misleading results in both directions.

### 2.2 The diagnostic snippet

Paste this into the DevTools console on your dashboard. It tells you, in one shot, exactly which gate you are failing.

```js
(async () => {
  const out = {};

  out.url             = location.origin;
  out.secureContext   = window.isSecureContext;
  out.hasBeenActive   = navigator.userActivation?.hasBeenActive ?? 'unsupported';
  out.visibility      = document.visibilityState;
  out.displayMode     = ['standalone','minimal-ui','window-controls-overlay','fullscreen']
                          .find(m => matchMedia(`(display-mode:${m})`).matches) || 'browser';

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { out.webAudio = 'UNSUPPORTED'; console.table(out); return; }

  const ctx = new AC();
  out.ctxStateOnCreate = ctx.state;
  out.sampleRate       = ctx.sampleRate;
  out.outputLatency    = ctx.outputLatency;

  try {
    await ctx.resume();
    out.ctxStateAfterResume = ctx.state;
  } catch (e) {
    out.resumeError = e.message;
  }

  out.verdict =
    ctx.state === 'running'
      ? 'AUDIO IS ALLOWED right now on this page load'
      : 'AUDIO IS BLOCKED — no sticky activation, no MEI, not an installed PWA';

  console.table(out);
  ctx.close();
})();
```

**How to read it:**

- `ctxStateOnCreate: "running"` immediately on a fresh page load with no clicks → you are being granted autoplay by MEI or PWA install. Check which at `chrome://media-engagement`.
- `ctxStateOnCreate: "suspended"` and `ctxStateAfterResume: "suspended"` → this is the normal blocked state. Expected.
- `hasBeenActive: false` → confirms no gesture yet on this document.
- `secureContext: false` → **stop, fix this first.** You are on plain HTTP. Web Audio, service workers, notifications, and wake lock all require HTTPS (localhost excepted). Nothing else in this guide will work.
- `displayMode: "standalone"` → you are already running as an installed PWA, which grants autoplay.

Now click anywhere on the page and run the snippet again. `ctxStateAfterResume` should flip to `running`. That confirms the fix in Part 3 will work.

### 2.3 Check the three browser-level pages

Have the vendor (or your remote-support session) visit these:

| Page | What to look for |
|---|---|
| `chrome://settings/content/sound` | Is your domain listed under "Not allowed to play sound"? Someone may have muted it by accident. |
| `chrome://media-engagement` | What is the score for your origin? Confirms whether MEI is masking the bug on this machine. |
| `chrome://policy` | Are any autoplay or sound policies already set by their IT? Filter for "autoplay". |

Edge uses `edge://` for all three.

### 2.4 Check the tab is not muted

Right-click the tab. If it says "Unmute site," the vendor has muted your dashboard at some point, probably by accident. Per-tab mute overrides everything — every fix in this document, including Electron. Worth checking first because it takes five seconds.

### 2.5 Confirm the sound actually leaves the machine

Obvious but it catches people. On the vendor PC:

1. Open Windows **Volume Mixer** (right-click speaker icon → Open volume mixer). Confirm the browser's slider is not at zero and not muted.
2. Confirm the **default output device** is the speaker the vendor can actually hear, not an HDMI monitor with no speakers, not a Bluetooth headset that is currently in a drawer.
3. Play any YouTube video. If that is silent, your problem is hardware or OS, not the dashboard.

### 2.6 Record what you find

Before moving on, you should be able to answer:

- Which browser and version is each vendor on?
- Is the dashboard served over HTTPS with a valid certificate?
- Is MEI masking the problem on your test machines?
- Do any vendors already have enterprise policy applied by their own IT?
- Do all vendors have working, audible speakers?

---

## Part 3 — Layer 1: Arm the audio at login

This is the application-code fix. Implement it first.

### 3.1 The mental model

Three phases, and the ordering is everything:

```
   LOGIN CLICK              SHIFT (minutes → hours)           ORDER ARRIVES
        │                            │                             │
        ▼                            ▼                             ▼
  resume() the ctx          ctx stays "running"            ring() — no gesture
  play silent blip          heartbeat verifies it          needed, works instantly
  decode ring buffer        buffer is in RAM               loops until accepted
        │
        └── from here, audio is unlocked for the whole page load
```

### 3.2 The five rules

Get these wrong and the fix silently fails.

**Rule 1 — `resume()` must be called synchronously inside the handler.**

```js
// BROKEN — the await breaks the activation chain
btn.addEventListener('click', async () => {
  const user = await fetch('/api/login');   // ← activation window closes here
  await audioCtx.resume();                  // ← too late, will not unlock
});

// CORRECT — resume() fires first, before anything can yield
btn.addEventListener('click', async () => {
  const resuming = audioCtx.resume();       // ← fire immediately
  const user = await fetch('/api/login');
  await resuming;
});
```

The activation is consumed the moment your handler yields to the event loop. Anything before the first `await` counts. Anything after it may not.

**Rule 2 — one AudioContext for the whole app, created once.**

Browsers cap the number of simultaneous AudioContexts per document (historically around six in Chrome). If you construct a new one per component render, you will hit the cap and everything dies. Make it a module-level singleton.

**Rule 3 — decode the ring buffer at login, not at order time.**

`decodeAudioData` on a 200KB MP3 takes tens of milliseconds and needs the file. Do it once, at arm time, and hold the AudioBuffer. Order-time playback then costs microseconds and no network.

**Rule 4 — React's synthetic events are fine, but `onSubmit` on a `<form>` is not always.**

React's synthetic click events preserve user activation correctly in current versions. Form submission handlers are riskier, particularly if something in your validation chain is async before you get to the audio call. Bind to the button's `onClick`, not the form's `onSubmit`.

**Rule 5 — verify, don't assume.**

`resume()` can resolve without the state becoming `running`. Always check `ctx.state === 'running'` afterwards, and surface the result in the UI.

### 3.3 The implementation

The full module is in [`app/order-alert.js`](app/order-alert.js). It provides:

```js
import * as Alert from './order-alert.js';

Alert.arm()              // unlock. Call from a user gesture. Returns bool.
Alert.ring(opts)         // start ringing, loops until stopped
Alert.stop()             // stop ringing
Alert.selfTest()         // short beep, for a "Test sound" button
Alert.subscribe(fn)      // state changes, for driving a status chip
Alert.installRearmNet()  // re-arm on any click if arming ever fails
Alert.holdScreenAwake()  // screen wake lock while a shift is active
Alert.listOutputDevices()  /  Alert.setOutputDevice(id)
```

Wiring it up:

```js
// 1. At app startup, before login
Alert.installRearmNet();

// 2. On the login button
loginButton.addEventListener('click', async () => {
  const resuming = Alert.arm();          // first line, no await before it
  const creds = readForm();
  const session = await api.login(creds);
  const armed = await resuming;
  if (!armed) {
    telemetry.warn('audio_arm_failed', { ua: navigator.userAgent });
  }
  startShift(session);
});

// 3. When the shift starts
Alert.holdScreenAwake();

// 4. On an incoming order
socket.on('order.created', (order) => {
  renderOrderCard(order);
  Alert.ring({ escalate: true });
});

// 5. On acknowledgement — and ONLY on acknowledgement
acceptButton.addEventListener('click', () => {
  Alert.stop();
  api.acknowledgeOrder(order.id);
});
```

### 3.4 Ring until acknowledged

This is the behavioural change you actually asked for, and it is independent of the autoplay fix.

A 3-second chime is a notification. A loop that does not stop until a human acts is an alarm. You want an alarm.

```js
node.loop = true;         // the ONLY thing that stops this is Alert.stop()
```

Do not add a timeout that stops the ring after N seconds. The ring stopping should mean "a human acknowledged," and nothing else. If you stop it automatically you have re-created the original bug with extra steps.

Tie `stop()` to exactly one thing: the Accept action. Not to `visibilitychange`, not to a "dismiss" button, not to a modal close. If you give the vendor a way to silence the alarm without accepting the order, they will use it, and orders will be missed.

### 3.5 Escalating volume

A single volume level is a compromise: loud enough to hear from the kitchen is painful at the counter. Ramp instead.

```js
// starts at 40%, climbs to 100% over 20 seconds
gain.gain.setValueAtTime(0.4, ctx.currentTime);
gain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 20);
```

The vendor at the counter hears a polite ring and accepts within five seconds. The vendor in the back gets progressively louder until they come and deal with it. The module implements this behind `ring({ escalate: true })`.

### 3.6 The status chip

Because arming can fail — a browser you have not tested, an extension interfering, an exotic policy — the vendor must be able to see the state at a glance. Put a chip in the header, always visible.

```js
Alert.subscribe(({ armed, ringing, contextState }) => {
  chip.textContent = armed ? 'Sound on' : 'Sound off — click here to fix';
  chip.dataset.state = armed ? 'ok' : 'error';
  chip.onclick = armed ? null : () => Alert.arm();
});
```

Write it in plain language. "Sound on" and "Sound off — click here to fix." Not "AudioContext: suspended." The vendor does not know what an AudioContext is and should never have to.

Make the broken state visually loud — red background, not a subtle grey icon. This chip is the thing that prevents a vendor from working a whole shift not knowing their alerts are dead.

### 3.7 Choosing the sound

Practical notes that matter more than they sound like they do:

- **Frequency range 800–2000 Hz.** This is where human hearing is most sensitive and where small PC speakers actually reproduce. A deep bass tone will be inaudible on the $8 speakers most vendors have.
- **Intermittent, not continuous.** A steady tone fades into the background within seconds. On/off cadence (400ms on, 600ms off) stays attention-grabbing indefinitely.
- **Two alternating pitches.** A rising-falling pair is much harder to ignore than a single repeated note.
- **Loop point must be clean.** Trim to a zero-crossing or you get a click on every loop, which is both annoying and quiet.
- **Keep the file small.** 1–2 seconds of mono at 96kbps is plenty. Under 30KB.
- **Ship a synthesised fallback.** If the MP3 fails to load — CDN hiccup, cache purge, bad deploy — you still need a noise. The module generates a two-tone ring in memory as a fallback, so an alert never depends on a network fetch succeeding.

Serve the ring file with a long `Cache-Control: max-age`, and version it in the filename (`ring-v2.mp3`) so you can change it without cache-busting problems.

### 3.8 Output device selection

Chrome 110+ supports `setSinkId()` on AudioContext, which lets you route the ring to a specific output device. This is genuinely useful: a vendor can plug a cheap USB speaker into the back of the PC, mount it on the wall, and send *only* the order ring to it while everything else stays on the normal output.

```js
const devices = await navigator.mediaDevices.enumerateDevices();
const outputs = devices.filter(d => d.kind === 'audiooutput');
await ctx.setSinkId(chosenDeviceId);
```

Caveat: you need microphone permission for `enumerateDevices()` to return device *labels*. Without it you get opaque IDs and empty labels, which are useless for a picker. Request permission once when the vendor opens the sound settings panel, and explain why. If they decline, fall back to the system default device.

### 3.9 Secondary attention channels

Sound is primary. Add these as reinforcement — they cost almost nothing:

**Flashing the tab title:**

```js
let flip = false;
const flasher = setInterval(() => {
  document.title = (flip = !flip) ? '🔔 NEW ORDER' : 'Vendor Dashboard';
}, 700);
// clearInterval(flasher) on acknowledge, and restore the title
```

Note that title flashing is subject to the same background-tab throttling described in Part 6. If the tab is hidden and audio is playing, the tab is exempt and this works. If audio failed, this gets throttled to once a minute and is useless. It reinforces the sound; it does not replace it.

**A full-screen, high-contrast overlay** on the order itself. If the vendor glances at the screen, there should be no ambiguity. Big text, large Accept button, order details visible without scrolling.

**Desktop notification:**

```js
if (Notification.permission === 'granted') {
  new Notification('New order', {
    body: `#${order.number} — ${order.items.length} items`,
    requireInteraction: true,   // stays until dismissed, doesn't auto-hide
    tag: `order-${order.id}`,   // replaces rather than stacks
  });
}
```

`requireInteraction: true` is the important flag — without it the notification disappears after a few seconds and the vendor never sees it. Request notification permission during onboarding, in the same gesture flow as arming audio.

Be aware: notifications will not appear if Windows is in Focus Assist / Do Not Disturb mode, which is another reason they are reinforcement rather than mechanism.

### 3.10 What Layer 1 does not fix

Be clear-eyed about the residual failure modes, because they are what drives you to Layers 2 and 3:

- Vendor leaves the dashboard open overnight; the session restores in the morning without a fresh login click. No gesture, no audio.
- The page reloads unattended — a deploy, a crash recovery, a network blip triggering a reload. Audio is lost until someone clicks.
- The vendor opens the dashboard in a second tab and works in that one, which has its own document and its own activation state.
- Browser restores tabs after an update restart. No gesture.

The rearm net catches most of these on the vendor's next click, but "next click" can be an hour away. That is why you keep going.

---

## Part 4 — Layer 2: Remove the restriction on vendor machines

Since you control what is installed on vendor PCs, you can remove the autoplay policy entirely rather than working around it. This makes Layer 1 redundant on machines where it applies — but keep Layer 1 anyway, because it covers vendors on machines you have not configured.

There are four approaches. Compare before choosing.

| Approach | Persists? | Needs admin? | Deployable at scale? | Breaks if... |
|---|---|---|---|---|
| Site setting (Sound: Allow) | Yes, per profile | No | No — manual per machine | Vendor clears browsing data or switches profile |
| Launch flag in shortcut | Yes, if in the shortcut | No | Yes, via script | Vendor launches Chrome any other way |
| Enterprise policy (registry) | Yes, machine-wide | Yes | Yes, via script/GPO/RMM | Nothing much. Most robust of the four. |
| Install as PWA | Yes | No | Semi — one click per machine | Vendor uninstalls the app |

### 4.1 Approach A — the site sound setting

Simplest, and worth telling vendors about as a self-service fix.

1. Open the dashboard.
2. Click the icon at the left of the address bar (tune/lock/info icon).
3. Choose **Site settings**.
4. Set **Sound** to **Allow**.

Or navigate directly to `chrome://settings/content/sound` and add your origin under "Allowed to play sound."

This survives restarts and is stored per browser profile. It does not survive clearing browsing data, and it has to be done by hand on every machine, so it is a stopgap rather than a deployment strategy.

### 4.2 Approach B — the launch flag

Chrome accepts a command-line switch that disables the autoplay policy wholesale:

```
--autoplay-policy=no-user-gesture-required
```

Important: this **does not persist** if you run it once from a terminal. Chrome reverts to the default policy the next time it is launched normally. You have to bake it into the shortcut the vendor actually uses. Also note that the corresponding `chrome://flags/#autoplay-policy` entry has been removed from Chrome's flags UI, so the command line (or policy) is the only route.

**Setting up the shortcut manually:**

Right-click the desktop shortcut → Properties → append to the **Target** field:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --autoplay-policy=no-user-gesture-required --app=https://dashboard.yourcompany.com
```

The `--app=` switch is worth adding for its own sake. It opens the dashboard in a frameless window with no address bar, no tabs, and no bookmarks. The vendor cannot accidentally navigate away, cannot open fifteen other tabs in the same window, and the window looks like an application rather than a browser. For a single-purpose vendor terminal this is a meaningful usability upgrade.

Other switches you may want:

| Switch | Effect | Worth it? |
|---|---|---|
| `--app=URL` | Frameless app window | Yes |
| `--kiosk` | Full screen, no chrome at all, hard to exit | Only for dedicated terminals |
| `--user-data-dir=PATH` | Separate profile just for the dashboard | Yes, isolates from the vendor's personal browsing |
| `--disable-background-timer-throttling` | Disables timer throttling | Helps, but see Part 6 for the better fix |
| `--disable-backgrounding-occluded-windows` | Stops deprioritising covered windows | Yes, for this use case |
| `--disable-renderer-backgrounding` | Keeps the renderer at full priority | Yes |
| `--noerrdialogs` | Suppresses error dialogs | For unattended terminals |

A combined shortcut target for a dedicated vendor terminal:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe"
  --autoplay-policy=no-user-gesture-required
  --app=https://dashboard.yourcompany.com
  --user-data-dir="C:\VendorDashboard\profile"
  --disable-background-timer-throttling
  --disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding
  --noerrdialogs
```

(All on one line in the actual Target field.)

A PowerShell script that creates this shortcut, pins it, and optionally adds it to Startup is in [`deploy/Install-VendorDashboard.ps1`](deploy/Install-VendorDashboard.ps1).

**The weakness:** the flag only applies when Chrome is launched *from that shortcut*. If the vendor clicks a Chrome icon in the taskbar, opens Chrome from the Start menu, or the dashboard opens in an already-running Chrome instance, the flag does not apply. You cannot control that. Which is why the next approach is better.

### 4.3 Approach C — enterprise policy (the robust one)

Chrome and Edge both honour machine-wide policies set in the registry. These apply to every launch, from every shortcut, for every user on the machine, and cannot be overridden by the user.

The two relevant policies:

- **`AutoplayAllowed`** — a boolean. Set to true and Chrome autoplays media everywhere, with no user consent needed. Left unset, Chrome does not autoplay.
- **`AutoplayAllowlist`** — a list of URL patterns where autoplay is always enabled. If `AutoplayAllowed` is set to true, the allowlist has no additional effect (everything is already allowed). If `AutoplayAllowed` is false, patterns in the allowlist can still play.

**Use the allowlist, not the global allow.** Setting `AutoplayAllowed=1` turns on autoplay for the entire internet on that machine, which means every ad on every site the vendor visits will blast audio at them. They will find the setting and turn it off, and you will be back where you started. The allowlist grants it only to your origin. Scope narrowly.

**Registry — Chrome:**

```
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\AutoplayAllowlist]
"1"="https://dashboard.yourcompany.com"
"2"="[*.]yourcompany.com"
```

**Registry — Edge:**

```
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\AutoplayAllowlist]
"1"="https://dashboard.yourcompany.com"
"2"="[*.]yourcompany.com"
```

A ready-to-run `.reg` file covering both is at [`deploy/enable-order-alert-autoplay.reg`](deploy/enable-order-alert-autoplay.reg). Edit the domain before distributing.

**Rules for the URL patterns:**

- A bare `*` is **not** a valid value. It will be rejected and the policy will silently do nothing.
- `[*.]yourcompany.com` matches the domain and all subdomains.
- `https://dashboard.yourcompany.com` matches that exact origin.
- Include the scheme where you can. Be as specific as possible.
- Entries are numbered string values (`"1"`, `"2"`, ...) under the `AutoplayAllowlist` key, as `REG_SZ`.

**Things that will waste your afternoon:**

1. **The policy only applies to newly opened tabs.** Changing it while Chrome is running does nothing to existing tabs. Close the browser completely — check Task Manager for lingering `chrome.exe` processes — and reopen.

2. **These are per-profile policies.** If the vendor has multiple Chrome profiles, verify in the one they actually use.

3. **`AutoplayAllowed` semantics have changed across Edge versions and the documentation is inconsistent about it.** Different sources give conflicting accounts of what *Disabled* maps to in Edge 146 through 148 — one says Disabled reverted to Block at 146, another says it maps back to Limit at 148. Do not rely on the meaning of Disabled. Either set the policy explicitly Enabled, or use `AutoplayAllowlist`, which has stable semantics. As of August 2026 Edge 151 is the current stable major version, so you are well past the ambiguous range, but the lesson holds: set things explicitly, never rely on a default.

4. **Edge does not support these policies on Android or iOS.** If any vendor is on a tablet, this approach does not reach them.

5. **HKCU vs HKLM.** `HKEY_LOCAL_MACHINE` applies to all users on the machine and requires admin rights. `HKEY_CURRENT_USER` applies to one user and does not. Prefer HKLM; fall back to HKCU if you cannot get admin.

**Verification — always do this:**

1. Fully close the browser.
2. Reopen and go to `chrome://policy` (or `edge://policy`).
3. Click **Reload policies**.
4. Filter for `Autoplay`. Confirm `AutoplayAllowlist` is listed, the value is your domain, status is **OK**, and there is no conflict warning.
5. Open the dashboard in a brand-new tab and run the Part 2 diagnostic snippet. `ctxStateOnCreate` should now be `running` with zero clicks.

If the policy shows up at `chrome://policy` but the diagnostic still says blocked, your URL pattern does not match. Check for `http` vs `https`, `www` vs bare domain, and a trailing slash.

**Deploying at scale.** If vendors are on machines you manage via an RMM tool (NinjaOne, Datto, Atera, Action1) or Intune, push the registry keys as a script or configuration profile. If they are independent businesses on their own PCs, you are shipping a signed `.exe` or `.msi` installer that writes these keys — bundle it with the shortcut creation from 4.2 into one installer the vendor double-clicks during onboarding.

### 4.4 Approach D — install as a PWA

Chrome grants autoplay to installed web apps. This is documented behaviour, not a loophole: adding a site to the home screen on mobile or installing it as a PWA on desktop is one of the conditions under which autoplay is permitted. It was designed exactly for the case of an installed app needing to behave like a native app.

This is the cheapest path to "no autoplay restriction" that requires no admin rights and no registry edits.

**Requirements:**

- Served over HTTPS.
- A valid web app manifest with `name`, `short_name`, `start_url`, `display`, and icons (192px and 512px minimum).
- A registered service worker with a fetch handler.

A minimal manifest:

```json
{
  "name": "Vendor Order Dashboard",
  "short_name": "Orders",
  "start_url": "/dashboard?source=pwa",
  "display": "standalone",
  "display_override": ["window-controls-overlay", "standalone"],
  "background_color": "#111111",
  "theme_color": "#111111",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Install it from the icon in the address bar, or the three-dot menu → Cast, save and share → Install page as app.

**Bonus benefits:** its own window with no tabs or address bar, its own taskbar icon, can be set to launch at login via Chrome's app settings, and runs in its own window so it is never "a tab the vendor lost."

**Detect that you are running installed**, so you can adjust your UI and skip the arming prompt:

```js
const isInstalled = matchMedia('(display-mode: standalone)').matches
                 || matchMedia('(display-mode: window-controls-overlay)').matches;
```

Log this to telemetry. It tells you which vendors took the install and which did not.

**The catch:** the vendor has to click Install, and they have to not uninstall it. In practice this means doing it for them during onboarding over a screen-share, and checking the telemetry flag afterwards.

---

## Part 5 — Layer 3: Ship a desktop wrapper

This is where you should end up. Every serious order-management product does this eventually, for the reasons below. A browser tab is a hostile environment for an alarm.

### 5.1 What it buys you

| Problem | Browser | Electron wrapper |
|---|---|---|
| Autoplay policy | Must be worked around | Does not exist. Electron's `autoplayPolicy` defaults to `no-user-gesture-required`. |
| Vendor forgets to open it | Constant support burden | Launches automatically at Windows login |
| Vendor closes the tab | Alerts stop dead | Closing hides to system tray, alerts continue |
| Window buried under others | Nobody sees the order | `flashFrame()` + `setAlwaysOnTop()` brings it forward |
| PC sleeps mid-shift | Orders missed | `powerSaveBlocker` prevents it |
| Background tab throttling | Timers throttled to 1/min | No tabs, no throttling |
| Tab discarded to save memory | App unloaded silently | Not applicable |
| Vendor on an ancient browser | Unpredictable | You ship the runtime, you control the version |
| Knowing the app is alive | Hard | Native process, trivially monitorable |

That autoplay default is worth restating: in Electron, `webPreferences.autoplayPolicy` accepts `no-user-gesture-required`, `user-gesture-required`, or `document-user-activation-required`, and **defaults to `no-user-gesture-required`**. You do not have to configure anything. The problem this entire document is about simply does not exist inside Electron.

### 5.2 The wrapper

A complete, production-shaped `main.js` is in [`desktop/main.js`](desktop/main.js). It is around 250 lines and it wraps your existing URL — you do not rewrite the dashboard. Key pieces:

**The window:**
```js
new BrowserWindow({
  webPreferences: {
    autoplayPolicy: 'no-user-gesture-required',  // explicit, though it's the default
    backgroundThrottling: false,                 // never throttle our timers
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
  },
});
```

`backgroundThrottling: false` is the one people forget. Without it, a minimised or fully-covered Electron window gets the same timer throttling as a background browser tab.

**Alerting the human:**
```js
function alertForOrder(order) {
  if (win.isMinimized()) win.restore();
  win.setAlwaysOnTop(true, 'screen-saver');   // above almost everything
  win.show();
  win.flashFrame(true);                        // taskbar icon flashes orange
  setTimeout(() => win.setAlwaysOnTop(false), 10_000);
}
```

`flashFrame` is the Windows taskbar flash. It is unobtrusive but hard to miss, and it keeps going until the window is focused.

**Preventing sleep:**
```js
const { powerSaveBlocker } = require('electron');
const id = powerSaveBlocker.start('prevent-display-sleep');
```

Use `prevent-display-sleep` (the strongest — keeps the screen on) while a shift is active, and release it when the vendor clocks out. `prevent-app-suspension` is weaker; it allows the display to sleep but keeps the app running, which is fine if you only care about the sound.

**Launch at login:**
```js
app.setLoginItemSettings({
  openAtLogin: true,
  openAsHidden: false,
  args: ['--autostart'],
});
```

This is the single highest-value feature in the whole wrapper. The most common cause of a missed order is nobody opened the dashboard.

**Tray icon and close-to-tray:**
```js
win.on('close', (e) => {
  if (!app.isQuitting) {
    e.preventDefault();
    win.hide();   // closing does NOT quit — alerts keep working
  }
});
```
With an explicit "Quit" in the tray menu so vendors can genuinely exit when they mean to.

**Detecting sleep and wake:**
```js
const { powerMonitor } = require('electron');
powerMonitor.on('suspend', () => telemetry('pc_suspended'));
powerMonitor.on('resume',  () => { reconnectSocket(); backfillMissedOrders(); });
```

The `resume` handler matters. When a PC wakes from sleep, your WebSocket is dead and you may have missed orders. Reconnect and explicitly ask the server for anything unacknowledged (see Part 6.5).

**Auto-update:**

Use `electron-updater` with a static file host or GitHub Releases. Without auto-update you will have vendors running a build from eighteen months ago and no way to fix them. Set it up on day one, not later.

**Native notifications** work through the same `Notification` API, but from Electron they are more reliable — they are registered against your app identity rather than the browser's.

### 5.3 Tauri as an alternative

Tauri produces much smaller binaries (a few MB versus ~80MB for Electron) because it uses the OS's built-in webview instead of bundling Chromium.

For this use case, weigh it carefully:

- **Against Tauri:** you are at the mercy of whatever WebView2/WKWebView version the OS has, including its autoplay behaviour, which you no longer fully control. And Tauri's `backgroundThrottling` option is explicitly **unsupported on Linux, Windows, and Android** — it only works on macOS 14+ and iOS 17+. Since your vendors are on Windows, you cannot turn off background throttling, which is one of the main reasons to wrap at all.
- **For Tauri:** much smaller download, lower memory, faster startup.

Given that reliability is the entire point here and download size is irrelevant for a once-per-vendor install, **Electron is the right choice for this specific problem.** Bundling your own Chromium means you control the behaviour exactly, on every machine, forever.

### 5.4 Distribution

- Build with `electron-builder`, target NSIS for a Windows installer.
- **Code-sign it.** An unsigned installer triggers a SmartScreen warning that says, in effect, "this software is dangerous." Half your vendors will not click through it. An OV code-signing certificate is a few hundred dollars a year and it is not optional for software you are asking small businesses to install.
- Have the installer write the Part 4 registry keys too, so that if a vendor also uses the browser version, that works as well.
- Auto-update from day one.

---

## Part 6 — The delivery problem (your next bug)

Everything above assumes the order event actually reaches the browser. Half of "the alert didn't fire" reports turn out to be "the event never arrived." The symptom is identical, so you will chase the audio for days before you find it. Fix both.

### 6.1 Never poll with setInterval

If your dashboard does `setInterval(checkForOrders, 5000)`, you have a latent 60-second delay, and here is exactly why.

Chrome applies escalating throttling to background timers:

- **Minimal throttling:** once a chain of timers exceeds 5 nested callbacks, the minimum timeout becomes 4ms. Normal, harmless.
- **Throttling:** background tab timers are batched and run at most once per second. This has been true since Chrome 11.
- **Intensive throttling** (Chrome 88+): timers are checked **once per minute**. This kicks in when *all* of the following are true: the page has been hidden more than 5 minutes, the timer chain count is 5 or greater, the page has been silent for at least 30 seconds, and WebRTC is not in use.

A dashboard sitting in a background tab hits every one of those conditions. Your 5-second poll becomes a 60-second poll. The order sits for a minute before your code even knows it exists.

There is also a **budget-based** limit: each background tab has a CPU time budget that regenerates slowly, applied after 10 seconds in the background.

**The exemptions are the interesting part:**

- **Pages playing audible audio are treated as user-visible and exempt from background timer throttling.** The exemption persists for a few seconds after the audio stops. Critically, Chrome only counts audio as audible when it shows the speaker icon on the tab — **silent audio streams do not grant the exemption.**
- Pages with real-time connections (WebSocket, WebRTC) are exempt from the *budget-based* throttling, and an active WebRTC connection exempts you from intensive throttling.

Note the circularity in the first exemption: once your alarm is actually ringing, the tab stops being throttled. But it has to *start* ringing first, and getting the event to start it is the problem. You cannot bootstrap your way out of this with timers.

### 6.2 Use a push transport

**Server-Sent Events (SSE)** — the right default for this. One-directional server→client, which is exactly your shape. Runs over plain HTTP, works through almost every corporate proxy and firewall, has automatic reconnection built into the browser, and supports `Last-Event-ID` for resuming where you left off.

```js
const es = new EventSource('/api/orders/stream');
es.addEventListener('order.created', (e) => {
  const order = JSON.parse(e.data);
  handleOrder(order);
});
es.onerror = () => {
  // browser auto-reconnects; surface a degraded state in the UI meanwhile
  setConnectionState('reconnecting');
};
```

Server side, send a keepalive comment every 15–30 seconds or proxies will kill the connection:

```
: keepalive\n\n
```

Watch out for HTTP/1.1's six-connections-per-origin limit — if the vendor opens several tabs, SSE connections will queue. Over HTTP/2 this is not an issue. Make sure you are serving HTTP/2.

**WebSocket** — use if you need bidirectional traffic (typing indicators, live order edits, presence). More moving parts: you implement your own reconnect with exponential backoff and jitter, your own heartbeat, and you deal with proxies that terminate idle connections.

**Long polling** — the fallback. Reliable, works everywhere, more server load. Have it as a degraded path if SSE fails repeatedly.

**Web Push** — genuinely different from all three: it goes through the OS push service and can wake a service worker even when the page is closed. Worth adding, but a service worker cannot play audio directly, so it can fire a notification (with the system notification sound) but not your ring. Treat it as a supplementary channel, not the main one.

### 6.3 Heartbeat both directions

The client must know the connection is alive, and the server must know the client is alive.

**Client → server:** send a ping every 20 seconds with the vendor ID and the audio-armed state. The server marks the vendor offline if it misses three in a row.

**Server → client:** the SSE keepalive comment, or a WebSocket ping frame. If the client has not heard anything in 45 seconds, it assumes the connection is dead and reconnects, regardless of what the connection object claims. Sockets lie — a WebSocket in state `OPEN` through a NAT that silently dropped the mapping will never tell you it is dead.

Show connection state in the UI, next to the sound chip. Two indicators: "Sound on" and "Connected." When either is wrong, the vendor sees it.

### 6.4 Reconnect properly

```js
let attempt = 0;
function scheduleReconnect() {
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  const jitter = Math.random() * base * 0.3;
  setTimeout(connect, base + jitter);
  attempt++;
}
// on successful connect: attempt = 0
```

The jitter matters. Without it, if your server restarts, every vendor reconnects at the same millisecond and knocks it over again.

### 6.5 Backfill on reconnect — the one people miss

**This is the most commonly missed piece of the whole system.** If an order is created while the vendor is disconnected, no amount of push infrastructure will deliver it, because there was nothing to push to. When the connection comes back, the order is already in the past.

Every reconnect must be followed by an explicit catch-up:

```js
async function onConnected() {
  const pending = await api.get('/orders/unacknowledged');
  for (const order of pending) {
    renderOrderCard(order);
  }
  if (pending.length > 0) {
    Alert.ring({ escalate: true });   // ring for orders that arrived while dark
  }
  setConnectionState('connected');
}
```

Drive this off **server-side acknowledgement state**, not off a client-side timestamp. The client's clock is wrong, its local storage may have been cleared, and it may have been offline across a page reload. The server knows which orders have not been acknowledged. Ask it.

Run the same backfill on:
- Initial page load
- Every reconnect
- `visibilitychange` → visible
- Electron's `powerMonitor` `resume` event
- Network `online` event

### 6.6 Deduplicate

With a push channel plus backfill on reconnect plus a visibility handler, the same order will reach your client multiple times. Key everything by order ID and make rendering and ringing idempotent.

```js
const seen = new Set();
function handleOrder(order) {
  if (seen.has(order.id)) return;
  seen.add(order.id);
  renderOrderCard(order);
  Alert.ring({ escalate: true });
}
```

Otherwise the ring restarts on every duplicate and the volume ramp resets, which is subtly maddening.

---

## Part 7 — The physical world

Software-perfect systems still fail here. Each of these has a real-world fix.

### 7.1 The tab is muted

Right-click on a tab → "Mute site" is one misclick away, and it overrides everything — Web Audio, `<audio>`, enterprise policy, all of it. Chrome remembers it per site.

You cannot detect this from JavaScript. There is no API that tells you the tab is muted. This is a hard blind spot.

**Mitigations:** the Electron wrapper eliminates it entirely (no tabs to mute). For browser users, put "Check the tab isn't muted" as step one of your troubleshooting doc and make the vendor test sound at the start of every shift.

### 7.2 Windows volume mixer

Windows keeps a per-application volume. A vendor who turned Chrome down to watch something quietly at 2am has turned your alarm down too, and it stays down.

**Mitigation:** shift-start sound test. Make it a required step — the vendor cannot mark themselves available until they have clicked "I heard it."

### 7.3 The default output device changed

Windows switches the default output device when a new one appears. A vendor plugs in headphones, or pairs a Bluetooth speaker, or connects an HDMI monitor with nominal speakers, and Windows silently reroutes all audio there. The ring plays perfectly, into a monitor that has no actual speakers.

**Mitigations:** use `setSinkId()` (section 3.8) to pin the ring to a specific device the vendor chooses once. Better: have the vendor use a dedicated USB speaker for the dashboard, mounted where it can be heard, and pin the ring to it.

### 7.4 The PC sleeps

Windows default is to sleep the display after 10 minutes and the machine after 30. A sleeping machine does not ring.

**Mitigations, in increasing order of reliability:**

1. `navigator.wakeLock.request('screen')` — a web API, keeps the screen on. Requires HTTPS and a visible page, and the lock is released when the page is hidden, so you must re-request on `visibilitychange`.
2. Electron's `powerSaveBlocker.start('prevent-display-sleep')`.
3. A Windows power plan change during vendor onboarding — set sleep to Never on the dashboard machine. Your installer can do this: `powercfg /change standby-timeout-ac 0`.

Do all three. Option 3 is the one that actually holds.

### 7.5 Nobody is in the room

The vendor is in the walk-in, out the back, serving a customer. This has nothing to do with software.

**Mitigations:** a loud external speaker positioned where the work actually happens, and Part 8's escalation to a phone.

### 7.6 Browser or OS updated overnight

Chrome restarts to apply an update. Tabs are restored, but no gesture has occurred, so audio is silent until someone clicks. Windows Update restarts the machine and the dashboard is not reopened at all.

**Mitigations:** the rearm net (3.6) catches the first case on the vendor's next click. Electron's launch-at-login catches the second. Together they close this off.

### 7.7 Speakers physically unplugged or broken

It happens more than you would expect, and it is invisible to you.

**Mitigation:** shift-start sound test, requiring a positive "I heard it" confirmation that you log. If a vendor stops passing the test, you find out before a customer does.

---

## Part 8 — The escalation ladder

**This is the part that actually solves the business problem.** Everything else reduces the failure rate. This is what happens when it fails anyway.

Build it **server-side**. A client-side escalation is worthless — if the client is dead, nothing runs. The server knows an order was created and not acknowledged, and the server has a phone number.

### 8.1 The ladder

| Elapsed | Action |
|---|---|
| 0s | Push the event. Client rings, flashes, shows the overlay. |
| 20s | Ring volume has ramped to maximum. Desktop notification fires with `requireInteraction`. |
| 45s | Server has seen no acknowledgement. Send SMS to the vendor's registered mobile. |
| 90s | Automated voice call to the vendor's mobile. A ringing phone in a pocket beats every browser API ever written. |
| 150s | Call/SMS the backup contact (owner, second manager). |
| 240s | Alert your own operations team. Optionally auto-reassign the order or notify the customer of a delay. |

Tune the intervals to your business. The structure is what matters: each rung is a **different channel on a different device**, so a single point of failure cannot swallow the whole chain.

### 8.2 Implementation shape

```
order.created
  └─> enqueue escalation job (delay 45s, key=order.id)
        └─> on fire: SELECT acknowledged_at FROM orders WHERE id = ?
              ├─ acknowledged  → cancel chain, done
              └─ not           → send SMS, enqueue next rung (delay 45s)
```

Use a job queue with delayed jobs and cancellation — BullMQ, Sidekiq, Celery, Temporal, or a `scheduled_at` column with a worker polling it. The key requirements:

- **Cancellable by order ID** when acknowledgement arrives.
- **Idempotent** — a retried job must not send two SMSes.
- **Survives a server restart** — the delay must be durable, not a `setTimeout` in a Node process.

### 8.3 Do not let it become noise

If vendors get an SMS for every order because the ladder is too aggressive, they will mute the SMS thread and you have lost the channel permanently. The ladder should fire on a small minority of orders. If more than about 5% of orders are reaching the SMS rung, your acknowledgement flow is too slow or your sound is not working — fix that rather than escalating harder.

Track "percentage of orders reaching each rung" as a health metric. It is the single best summary of whether the whole system works.

---

## Part 9 — Observability: knowing it's broken before the vendor calls

Right now you find out the system is broken when an angry vendor phones you. That is the real bug. Instrument it.

### 9.1 Client heartbeat

Every 30 seconds, the client posts:

```json
{
  "vendorId": "v_1234",
  "ts": "2026-09-12T14:22:01Z",
  "audioArmed": true,
  "audioContextState": "running",
  "connectionState": "connected",
  "displayMode": "standalone",
  "tabVisible": false,
  "appVersion": "2.4.1",
  "userAgent": "...",
  "lastRingAt": "2026-09-12T13:58:44Z",
  "lastRingHeard": true
}
```

Server-side, alert your ops team when:

- A vendor marked "open for business" has not sent a heartbeat in 3 minutes.
- A vendor's `audioArmed` is `false` for more than 5 minutes during business hours. **This is the money alert.** It tells you an order is going to be missed *before* it is missed.
- A vendor's `appVersion` is more than two releases behind.

### 9.2 Events to log

| Event | Why |
|---|---|
| `audio_arm_attempted` / `audio_arm_succeeded` / `audio_arm_failed` | Arm success rate by browser and version. Tells you which browsers are broken. |
| `audio_rearm_triggered` | How often the safety net is doing work. High numbers mean login arming is failing. |
| `ring_started` / `ring_stopped` | Time-to-acknowledge, per order, per vendor. |
| `sound_test_passed` / `sound_test_failed` | Which vendors have broken speakers. |
| `escalation_rung_reached` | The top-level health metric. |
| `connection_lost` / `connection_restored` | Network quality per vendor. |
| `backfill_delivered_orders` | How many orders arrive via catch-up rather than push. Non-zero means your push channel is dropping events. |

### 9.3 The one metric that matters

**Time to acknowledge**, measured server-side from order creation to acknowledgement, plotted as a distribution rather than an average.

The average hides everything. What you want is the p95 and p99, and a count of orders over 60 seconds. If p99 drops from four minutes to twenty seconds after you ship Layer 1, you have proof the fix worked. If one vendor's p99 is an outlier, you know exactly who to call.

### 9.4 Give vendors a self-service diagnostic

A "Check my setup" page inside the dashboard that runs, in order:

1. Audio context state → pass/fail
2. Play a test ring → "Did you hear that?" with Yes/No buttons
3. Connection status → pass/fail
4. Notification permission → pass/fail
5. Browser and version → flag if unsupported
6. Output device → show which device sound is going to

This deflects a large share of support calls and, more importantly, generates the telemetry in 9.2 automatically.

---

## Part 10 — Rollout plan

### Week 1 — Stop the bleeding

- [ ] Confirm the dashboard is HTTPS everywhere with a valid certificate.
- [ ] Ship `order-alert.js` with arming on the login click.
- [ ] Change the ring to loop until acknowledged, wired only to the Accept action.
- [ ] Add the sound status chip to the header.
- [ ] Add the rearm net.
- [ ] Add the "Test sound" button.
- [ ] Remove the "please turn on sound" popup, or downgrade it to a passive banner. It should never block the order view.
- [ ] Start logging `audio_arm_*` events.

### Week 2 — Build the safety net

- [ ] Server-side escalation ladder through SMS.
- [ ] Client heartbeat every 30s with `audioArmed`.
- [ ] Alert on `audioArmed === false` during business hours.
- [ ] Time-to-acknowledge dashboard with p95/p99.

### Week 3 — Fix delivery

- [ ] Replace polling with SSE or WebSocket if you have not already.
- [ ] Heartbeat both directions, with a visible connection indicator.
- [ ] Exponential backoff with jitter on reconnect.
- [ ] **Backfill unacknowledged orders on every reconnect, visibility change, and page load.**
- [ ] Deduplicate by order ID.

### Week 4 — Remove the restriction

- [ ] Build and sign the installer that writes the registry policy and creates the shortcut.
- [ ] Add the PWA manifest and service worker; offer install during onboarding.
- [ ] Write the vendor setup guide with screenshots.
- [ ] Roll out to five friendly vendors first. Verify at `chrome://policy` on each.
- [ ] Then roll out to everyone.

### Week 5–6 — The wrapper

- [ ] Electron wrapper around the existing URL.
- [ ] Launch at login, tray icon, close-to-tray, flash frame, power save blocker.
- [ ] Code-signed installer and auto-update.
- [ ] Migrate vendors one region at a time, watching time-to-acknowledge.

### Ongoing

- [ ] Shift-start sound test, required before a vendor can go "available."
- [ ] Monthly review of escalation-rung percentages by vendor.
- [ ] Watch Chrome and Edge release notes for autoplay policy changes.

---

## Part 11 — Troubleshooting matrix

| Symptom | Most likely cause | Check | Fix |
|---|---|---|---|
| Works for you, not for vendors | MEI on your machine | `chrome://media-engagement` | Test on a clean profile (2.1) |
| Popup asking to enable sound | No sticky activation | `navigator.userActivation.hasBeenActive` | Arm at login (Part 3) |
| Worked yesterday, silent today | Browsing data cleared, or browser restarted for an update | Diagnostic snippet (2.2) | Rearm net + Layer 2 policy |
| Silent for one vendor only | Tab muted, or mixer at zero | Right-click tab; open Volume Mixer | Unmute; shift-start test |
| Rings but nobody hears it | Wrong output device, or speaker too far away | Windows sound settings | `setSinkId()`; external speaker |
| Ring stops after 3 seconds | `loop` not set, or a timeout is stopping it | Read your ring code | `node.loop = true`, remove the timeout |
| Ring restarts constantly | Duplicate events | Log the order IDs arriving | Deduplicate by ID (6.6) |
| Order appears 60s late | Background timer throttling | Is the tab hidden? Are you polling? | Switch to SSE/WebSocket (6.2) |
| Order never appears | Disconnected, no backfill | Connection state; server-side ack table | Backfill on reconnect (6.5) |
| Policy set but still blocked | Pattern mismatch, or browser not fully restarted | `chrome://policy` → Reload → filter Autoplay | Fix the URL pattern; kill all chrome.exe |
| Policy not listed at all | Wrong registry hive or key name | Registry path exactly as in 4.3 | HKLM, correct vendor subkey |
| Works in Chrome, not Edge | Policy written to Chrome's key only | `edge://policy` | Write both keys (4.3) |
| Nothing works after deploy | Mixed content or certificate error | `window.isSecureContext` | Fix HTTPS first |
| Silent overnight, fine by day | PC sleeping | Windows power settings | `powercfg`, wake lock, powerSaveBlocker |
| Electron window silent | `backgroundThrottling` left on, or muted at OS level | Volume mixer for your app | `backgroundThrottling: false` |

---

## Appendix A — Browser-by-browser reference

### Chrome (and all Chromium derivatives)

- Autoplay policy since Chrome 66 for media elements, Chrome 71 for Web Audio.
- Gates: muted / user interaction / MEI / installed PWA.
- MEI inspector: `chrome://media-engagement`.
- Site sound setting: `chrome://settings/content/sound`.
- Policy inspector: `chrome://policy`.
- Command line: `--autoplay-policy=no-user-gesture-required`.
- The `chrome://flags/#autoplay-policy` entry has been removed from the flags UI.
- Enterprise policies: `AutoplayAllowed` (bool), `AutoplayAllowlist` (list of URL patterns). Registry: `HKLM\SOFTWARE\Policies\Google\Chrome`. Per-profile. Applies only to newly opened tabs.
- Also disableable for testing: `--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies` turns MEI-based bypass off, which is useful for making your test environment behave like a fresh vendor machine.

### Microsoft Edge

- Same Chromium engine, same underlying policy.
- User setting: `edge://settings/content/mediaAutoplay` — options are Allow, Limit, and (version-dependent) Block.
- Enterprise policies: `AutoplayAllowed`, `AutoplayAllowlist`. Registry: `HKLM\SOFTWARE\Policies\Microsoft\Edge`.
- `AutoplayAllowlist` supported on Windows and macOS from Edge 93 onward. **Not supported on Android or iOS.**
- The meaning of *Disabled* for `AutoplayAllowed` has shifted between versions and the documentation is inconsistent about the 146–148 range. Set the policy explicitly Enabled, or use the allowlist. Do not depend on defaults.
- Edge 151 was the current stable major version as of August 2026.
- Edge's "sleeping tabs" feature can suspend background tabs. Add your domain to the never-sleep list, or use the wrapper.

### Firefox

- Blocks autoplay of audible media by default; per-site permission via the icon in the address bar.
- Global setting: Settings → Privacy & Security → Permissions → Autoplay.
- `about:config` key: `media.autoplay.default` (0 = allow, 1 = block audio, 5 = block audio and video).
- Enterprise deployment via `policies.json`, using the `Permissions` → `Autoplay` block with an `Allow` array of origins.
- Firefox throttles background timers less aggressively than Chrome but unloads inactive tabs under memory pressure.

### Safari / macOS

- Per-site autoplay settings under Safari → Settings → Websites → Auto-Play.
- Does not support the same enterprise policies; managed via configuration profiles (MDM).
- Historically the strictest about Web Audio unlock — the one-sample silent buffer trick in `arm()` exists specifically for Safari and iOS.
- If any vendor is on a Mac or iPad, test separately. Do not assume Chromium behaviour carries over.

### Electron

- `webPreferences.autoplayPolicy` accepts `no-user-gesture-required`, `user-gesture-required`, or `document-user-activation-required`, and **defaults to `no-user-gesture-required`**. Autoplay works out of the box.
- Set `backgroundThrottling: false` explicitly. It defaults to on.

### Tauri

- Uses the OS webview, so autoplay behaviour follows WebView2 on Windows.
- `backgroundThrottling` is **unsupported on Windows, Linux, and Android**; only macOS 14+ and iOS 17+.
- Not recommended for this use case.

---

## Appendix B — Glossary

**Autoplay policy** — the browser rule that prevents pages from playing audible media without user interaction.

**AudioContext** — the Web Audio API's root object. Starts `suspended` when created without user activation; must be `resume()`d from a gesture.

**Backfill** — asking the server for unacknowledged items after a reconnect, since push events sent while disconnected are lost forever.

**Intensive throttling** — Chrome's most aggressive timer limiting: once per minute, for hidden pages meeting several conditions simultaneously.

**MEI (Media Engagement Index)** — a per-user, per-origin score of media consumption. When high enough, Chrome grants that origin autoplay automatically. Invisible, unreliable, the cause of most "works on my machine" reports in this domain.

**PWA (Progressive Web App)** — an installable web application. Installed PWAs are granted autoplay on desktop.

**Sticky activation** — a permanent per-document flag meaning "the user has interacted with this document at least once." Audio playback is gated on this. The basis of the login-arming fix.

**Transient activation** — a short-lived window following a gesture, required by intrusive APIs. Expires in seconds. Not what audio needs, but often confused with sticky activation.

**User gesture / user activation** — a real click, tap, or key press. Not a programmatic `.click()` call, which does not count.

**Wake lock** — `navigator.wakeLock`, a web API to keep the screen from sleeping. Requires HTTPS and a visible page.
