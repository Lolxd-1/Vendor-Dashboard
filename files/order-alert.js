/**
 * order-alert.js — ring-until-acknowledged alert engine for vendor dashboards.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THAT MATTERS
 *
 *   Call arm() from inside a real user gesture handler — the login button click.
 *   Do NOT call it when an order arrives. By then it is too late.
 *
 *   Once the AudioContext reaches state "running", it stays running for the
 *   lifetime of the page. Every order after that rings with zero interaction.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Quick start:
 *
 *   import * as Alert from './order-alert.js';
 *
 *   Alert.installRearmNet();                       // once, at app startup
 *
 *   loginBtn.addEventListener('click', async () => {
 *     const resuming = Alert.arm();                // FIRST line. No await before it.
 *     const session  = await api.login(readForm());
 *     await resuming;
 *     startShift(session);
 *   });
 *
 *   socket.on('order.created', () => Alert.ring({ escalate: true }));
 *   acceptBtn.addEventListener('click', () => Alert.stop());
 *
 * No dependencies. Works as an ES module or can be trivially wrapped in UMD.
 */

/* ══════════════════════════════════════════════════════════════════════════ */
/* Configuration                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

const CONFIG = {
  /** Ring sample. 1–2s, mono, loopable, trimmed to zero-crossings.
   *  Version the filename so you can cache it forever. */
  ringUrl: '/sounds/order-ring-v1.mp3',

  /** How often to verify the context is still running. */
  healthIntervalMs: 15_000,

  /** Escalating volume: start here, ramp to 1.0 over rampSeconds. */
  startVolume: 0.4,
  rampSeconds: 20,

  /** Called with (eventName, payload) for every notable event.
   *  Wire this to your telemetry. */
  onEvent: (name, payload) => {
    if (typeof console !== 'undefined') console.debug('[order-alert]', name, payload || '');
  },
};

/** Override defaults before first use: Alert.configure({ ringUrl: '...' }) */
export function configure(partial) {
  Object.assign(CONFIG, partial);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Internal state — single instance for the whole app                         */
/* ══════════════════════════════════════════════════════════════════════════ */

let ctx = null;          // the one and only AudioContext
let ringBuffer = null;   // decoded, held in RAM, never re-fetched
let sourceNode = null;
let gainNode = null;

let armed = false;
let ringing = false;
let ringStartedAt = null;
let healthTimer = null;
let rearmInstalled = false;
let preferredSinkId = null;

const listeners = new Set();

/* ══════════════════════════════════════════════════════════════════════════ */
/* State reporting                                                            */
/* ══════════════════════════════════════════════════════════════════════════ */

export function getState() {
  return {
    armed,
    ringing,
    contextState: ctx ? ctx.state : 'none',
    ringingForMs: ringStartedAt ? Date.now() - ringStartedAt : 0,
    bufferLoaded: !!ringBuffer,
    sinkId: preferredSinkId,
    hasBeenActive: navigator.userActivation?.hasBeenActive ?? null,
  };
}

/**
 * Subscribe to state changes. Fires immediately with current state.
 * Use this to drive the "Sound on / Sound off" chip in your header.
 * Returns an unsubscribe function.
 */
export function subscribe(fn) {
  listeners.add(fn);
  try { fn(getState()); } catch (err) { console.error('[order-alert] listener threw', err); }
  return () => listeners.delete(fn);
}

function emit() {
  const snapshot = getState();
  for (const fn of listeners) {
    try { fn(snapshot); } catch (err) { console.error('[order-alert] listener threw', err); }
  }
}

function event(name, payload) {
  try { CONFIG.onEvent(name, payload); } catch (err) { console.error(err); }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Arming — the critical path                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Unlock audio for the lifetime of this page.
 *
 * MUST be called synchronously from a user gesture handler (click, keydown,
 * pointerdown). If you await anything before calling this, the browser will
 * no longer consider you inside the gesture and arming will silently fail.
 *
 * Safe to call repeatedly — it is a no-op once armed.
 *
 * @returns {Promise<boolean>} true if audio is now guaranteed to work.
 */
export async function arm() {
  if (armed && ctx && ctx.state === 'running') return true;

  event('audio_arm_attempted', { ua: navigator.userAgent });

  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) {
    event('audio_arm_failed', { reason: 'no_web_audio' });
    emit();
    return false;
  }

  // One context for the whole app. Browsers cap how many you can create.
  if (!ctx) {
    ctx = new AudioCtor({ latencyHint: 'interactive' });
  }

  // Fire resume() synchronously — nothing may await before this line.
  const resuming = ctx.resume();

  // One-sample silent buffer. Required to fully unlock Safari and iOS, which
  // want to see an actual playback start inside the gesture, not just a resume.
  try {
    const blip = ctx.createBufferSource();
    blip.buffer = ctx.createBuffer(1, 1, 22050);
    blip.connect(ctx.destination);
    blip.start(0);
  } catch (err) {
    // Non-fatal. Chromium does not need this.
    console.warn('[order-alert] silent blip failed', err);
  }

  try {
    await resuming;
  } catch (err) {
    event('audio_arm_failed', { reason: 'resume_rejected', message: err.message });
    armed = false;
    emit();
    return false;
  }

  armed = ctx.state === 'running';

  if (armed) {
    event('audio_arm_succeeded', {
      sampleRate: ctx.sampleRate,
      outputLatency: ctx.outputLatency,
    });
    startHealthMonitor();
    loadRing();            // preload in background; do not await
    applySinkId();         // restore a previously chosen output device
  } else {
    event('audio_arm_failed', { reason: 'state_' + ctx.state });
  }

  emit();
  return armed;
}

/**
 * Safety net. If arming ever fails or the context gets suspended, this
 * re-arms on the vendor's next interaction anywhere in the app, and on
 * the next time the tab becomes visible.
 *
 * Call once at app startup. Idempotent.
 */
export function installRearmNet() {
  if (rearmInstalled) return;
  rearmInstalled = true;

  const rearm = () => {
    if (armed && ctx && ctx.state === 'running') return;
    event('audio_rearm_triggered', { from: 'gesture' });
    arm();
  };

  // capture:true so we see the event even if a handler stops propagation
  for (const type of ['pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(type, rearm, { capture: true, passive: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (ctx && ctx.state === 'suspended') {
      event('audio_rearm_triggered', { from: 'visibility' });
      ctx.resume().then(() => { armed = ctx.state === 'running'; emit(); }).catch(emit);
    }
  });
}

function startHealthMonitor() {
  if (healthTimer) return;
  healthTimer = setInterval(() => {
    if (!ctx) return;
    const wasArmed = armed;

    if (ctx.state !== 'running') {
      armed = false;
      if (wasArmed) event('audio_context_lost', { state: ctx.state });
      ctx.resume()
        .then(() => {
          armed = ctx.state === 'running';
          if (armed && !wasArmed) event('audio_context_recovered');
          emit();
        })
        .catch(emit);
    } else if (!wasArmed) {
      armed = true;
      emit();
    }
  }, CONFIG.healthIntervalMs);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Sound loading                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

let loadingPromise = null;

async function loadRing() {
  if (ringBuffer) return ringBuffer;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const res = await fetch(CONFIG.ringUrl, { cache: 'force-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      ringBuffer = await ctx.decodeAudioData(await res.arrayBuffer());
      event('ring_buffer_loaded', { source: 'file', duration: ringBuffer.duration });
    } catch (err) {
      // Never let a network failure mean silence.
      console.warn('[order-alert] ring file unavailable, synthesising', err);
      ringBuffer = synthesiseRing();
      event('ring_buffer_loaded', { source: 'synth', reason: err.message });
    }
    emit();
    return ringBuffer;
  })();

  return loadingPromise;
}

/**
 * Two-tone alternating ring, generated in memory.
 *
 * 800–1200 Hz sits in the most sensitive part of human hearing and is what
 * cheap PC speakers actually reproduce. The on/off cadence stops the brain
 * from filtering it out the way it does a continuous tone.
 */
function synthesiseRing() {
  const sr = ctx.sampleRate;
  const duration = 2.0;               // two 1s cycles, alternating pitch
  const buf = ctx.createBuffer(1, Math.floor(duration * sr), sr);
  const data = buf.getChannelData(0);

  const TONE_MS = 0.40;               // 400ms on
  const FADE = 0.015;                 // 15ms ramps, prevents clicks

  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    const cycle = t % 1.0;

    if (cycle >= TONE_MS) { data[i] = 0; continue; }

    const freq = (t % 2.0) < 1.0 ? 880 : 1175;   // A5 then D6
    const fadeIn = Math.min(cycle / FADE, 1);
    const fadeOut = Math.min((TONE_MS - cycle) / FADE, 1);
    const env = Math.max(0, Math.min(fadeIn, fadeOut));

    data[i] = Math.sin(2 * Math.PI * freq * t) * 0.7 * env;
  }
  return buf;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Ringing                                                                    */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Start ringing. Loops forever until stop() is called.
 *
 * @param {object}  opts
 * @param {boolean} opts.escalate  ramp volume from startVolume to 1.0 (default true)
 * @param {number}  opts.volume    fixed volume 0–1 when escalate is false
 * @returns {Promise<boolean>} false if audio was never armed — use this to
 *          trigger your out-of-band fallback (SMS, call, push).
 */
export async function ring({ escalate = true, volume = 1.0 } = {}) {
  if (ringing) return true;   // idempotent: duplicate order events must not restart it

  if (!armed || !ctx) {
    event('ring_failed', { reason: 'not_armed', contextState: ctx ? ctx.state : 'none' });
    emit();
    return false;
  }

  const buf = await loadRing();

  if (ctx.state !== 'running') {
    try { await ctx.resume(); } catch (_) { /* fall through, check below */ }
  }
  if (ctx.state !== 'running') {
    event('ring_failed', { reason: 'context_suspended' });
    armed = false;
    emit();
    return false;
  }

  gainNode = ctx.createGain();
  const now = ctx.currentTime;

  if (escalate) {
    gainNode.gain.setValueAtTime(CONFIG.startVolume, now);
    gainNode.gain.linearRampToValueAtTime(1.0, now + CONFIG.rampSeconds);
  } else {
    gainNode.gain.setValueAtTime(volume, now);
  }

  gainNode.connect(ctx.destination);

  sourceNode = ctx.createBufferSource();
  sourceNode.buffer = buf;
  sourceNode.loop = true;              // the ONLY thing that stops this is stop()
  sourceNode.connect(gainNode);
  sourceNode.start(0);

  ringing = true;
  ringStartedAt = Date.now();
  event('ring_started', { escalate });
  emit();
  return true;
}

/**
 * Stop ringing.
 *
 * Wire this to the "Accept order" action and NOTHING ELSE. If you give the
 * vendor a way to silence the alarm without accepting the order, they will
 * use it, and orders will be missed.
 */
export function stop() {
  if (!ringing) return;

  const duration = ringStartedAt ? Date.now() - ringStartedAt : 0;

  // 30ms fade so stopping doesn't produce an audible click
  if (gainNode && ctx) {
    const now = ctx.currentTime;
    try {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.03);
    } catch (_) { /* ignore */ }
  }

  const toStop = sourceNode;
  const toDisconnect = gainNode;
  sourceNode = null;
  gainNode = null;
  ringing = false;
  ringStartedAt = null;

  setTimeout(() => {
    try { toStop && toStop.stop(); } catch (_) {}
    try { toStop && toStop.disconnect(); } catch (_) {}
    try { toDisconnect && toDisconnect.disconnect(); } catch (_) {}
  }, 40);

  event('ring_stopped', { durationMs: duration });
  emit();
}

/**
 * Short test beep for a "Test sound" button. Returns false if blocked,
 * which is exactly what you want to show the vendor.
 */
export async function selfTest() {
  if (ringing) return true;              // already obviously working
  const ok = await ring({ escalate: false, volume: 0.7 });
  if (ok) setTimeout(stop, 1400);
  event(ok ? 'sound_test_played' : 'sound_test_failed');
  return ok;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Output device routing (Chrome 110+)                                        */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * List available audio output devices.
 *
 * Device LABELS are only populated if the page has microphone permission.
 * Without it you get opaque IDs, which are useless in a picker. Call
 * requestDeviceLabels() first if you need a human-readable list.
 */
export async function listOutputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(d => d.kind === 'audiooutput')
    .map(d => ({ id: d.deviceId, label: d.label || '(unnamed device)' }));
}

/**
 * Ask for microphone permission purely to unlock device labels.
 * Explain to the vendor why you are asking — "so we can show you a list of
 * your speakers" — or they will decline and you will get opaque IDs.
 */
export async function requestDeviceLabels() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());   // we only wanted the permission
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Pin the ring to a specific output device — e.g. a USB speaker mounted on
 * the wall, so the alarm is heard where the work happens rather than on
 * whatever Windows last decided was the default.
 */
export async function setOutputDevice(deviceId) {
  preferredSinkId = deviceId;
  try { localStorage.setItem('orderAlert.sinkId', deviceId); } catch (_) {}
  return applySinkId();
}

async function applySinkId() {
  if (!preferredSinkId) {
    try { preferredSinkId = localStorage.getItem('orderAlert.sinkId'); } catch (_) {}
  }
  if (!preferredSinkId || !ctx || typeof ctx.setSinkId !== 'function') return false;
  try {
    await ctx.setSinkId(preferredSinkId);
    event('output_device_set', { deviceId: preferredSinkId });
    return true;
  } catch (err) {
    // Device was unplugged. Fall back to system default rather than going silent.
    event('output_device_failed', { deviceId: preferredSinkId, message: err.message });
    preferredSinkId = null;
    try { localStorage.removeItem('orderAlert.sinkId'); } catch (_) {}
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Keep the machine awake during a shift                                      */
/* ══════════════════════════════════════════════════════════════════════════ */

let wakeLock = null;

/**
 * Keep the screen on while a shift is active. Requires HTTPS.
 * The lock is released whenever the page is hidden, so we re-acquire it.
 *
 * This is a best-effort web API. The reliable fix is a Windows power plan
 * change during onboarding, or the Electron powerSaveBlocker.
 */
export async function holdScreenAwake() {
  if (!('wakeLock' in navigator)) return false;

  const acquire = async () => {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => event('wake_lock_released'));
      event('wake_lock_acquired');
      return true;
    } catch (err) {
      event('wake_lock_failed', { message: err.message });
      return false;
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!wakeLock || wakeLock.released)) {
      acquire();
    }
  });

  return acquire();
}

export function releaseScreenAwake() {
  try { wakeLock && wakeLock.release(); } catch (_) {}
  wakeLock = null;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Diagnostics                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Snapshot for your heartbeat payload and your "Check my setup" page. */
export function diagnostics() {
  return {
    ...getState(),
    secureContext: window.isSecureContext,
    displayMode: ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen']
      .find(m => matchMedia(`(display-mode:${m})`).matches) || 'browser',
    notificationPermission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
    wakeLockSupported: 'wakeLock' in navigator,
    setSinkIdSupported: !!(ctx && typeof ctx.setSinkId === 'function'),
    sampleRate: ctx ? ctx.sampleRate : null,
    userAgent: navigator.userAgent,
    tabVisible: document.visibilityState === 'visible',
  };
}
