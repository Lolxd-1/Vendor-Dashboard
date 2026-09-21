/**
 * order-alert.ts — ring-until-acknowledged alert engine for vendor dashboards.
 * TypeScript port of files/order-alert.js (Layer 1 of GUIDE.md).
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
 *   import * as Alert from './order-alert';
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
 */

export interface AlertConfig {
  ringUrl: string;
  healthIntervalMs: number;
  startVolume: number;
  rampSeconds: number;
  onEvent: (name: string, payload?: unknown) => void;
}

export interface AlertState {
  armed: boolean;
  ringing: boolean;
  contextState: string;
  ringingForMs: number;
  bufferLoaded: boolean;
  sinkId: string | null;
  hasBeenActive: boolean | null;
}

export interface DiagnosticsSnapshot extends AlertState {
  secureContext: boolean;
  displayMode: string;
  notificationPermission: string;
  wakeLockSupported: boolean;
  setSinkIdSupported: boolean;
  sampleRate: number | null;
  userAgent: string;
  tabVisible: boolean;
}

const CONFIG: AlertConfig = {
  // Remastered bell: normalised to full scale (peaks 0dB). Version the
  // filename so it can be cached forever.
  ringUrl: '/order-ring-v2.mp3',
  healthIntervalMs: 15_000,
  // Absolute max from the very first second (vendor's choice — no polite ramp).
  startVolume: 1.0,
  rampSeconds: 1,
  onEvent: (name, payload) => {
    if (typeof console !== 'undefined') console.debug('[order-alert]', name, payload ?? '');
  },
};

/** Override defaults before first use: Alert.configure({ ringUrl: '...' }) */
export function configure(partial: Partial<AlertConfig>): void {
  Object.assign(CONFIG, partial);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Internal state — single instance for the whole app                         */
/* ══════════════════════════════════════════════════════════════════════════ */

let ctx: AudioContext | null = null;
let ringBuffer: AudioBuffer | null = null;
let sourceNode: AudioBufferSourceNode | null = null;
let gainNode: GainNode | null = null;
let compNode: DynamicsCompressorNode | null = null;

let armed = false;
let ringing = false;
let ringStartedAt: number | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let rearmInstalled = false;
let preferredSinkId: string | null = null;

const listeners = new Set<(s: AlertState) => void>();

/* ══════════════════════════════════════════════════════════════════════════ */
/* State reporting                                                            */
/* ══════════════════════════════════════════════════════════════════════════ */

export function getState(): AlertState {
  return {
    armed,
    ringing,
    contextState: ctx ? ctx.state : 'none',
    ringingForMs: ringStartedAt ? Date.now() - ringStartedAt : 0,
    bufferLoaded: !!ringBuffer,
    sinkId: preferredSinkId,
    hasBeenActive: typeof navigator !== 'undefined' && 'userActivation' in navigator
      ? ((navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }).userActivation?.hasBeenActive ?? null)
      : null,
  };
}

/**
 * Subscribe to state changes. Fires immediately with current state.
 * Use this to drive the "Sound on / Sound off" chip in your header.
 * Returns an unsubscribe function.
 */
export function subscribe(fn: (s: AlertState) => void): () => void {
  listeners.add(fn);
  try { fn(getState()); } catch (err) { console.error('[order-alert] listener threw', err); }
  return () => { listeners.delete(fn); };
}

function emit(): void {
  const snapshot = getState();
  for (const fn of listeners) {
    try { fn(snapshot); } catch (err) { console.error('[order-alert] listener threw', err); }
  }
}

function event(name: string, payload?: unknown): void {
  try { CONFIG.onEvent(name, payload); } catch (err) { console.error(err); }
}

function getAudioCtor(): typeof AudioContext | null {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext || w.webkitAudioContext || null;
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
 */
export async function arm(): Promise<boolean> {
  if (armed && ctx && ctx.state === 'running') return true;

  event('audio_arm_attempted', { ua: navigator.userAgent });

  const AudioCtor = getAudioCtor();
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
    console.warn('[order-alert] silent blip failed', err);
  }

  try {
    await resuming;
  } catch (err) {
    event('audio_arm_failed', { reason: 'resume_rejected', message: (err as Error).message });
    armed = false;
    emit();
    return false;
  }

  armed = ctx.state === 'running';

  if (armed) {
    event('audio_arm_succeeded', {
      sampleRate: ctx.sampleRate,
      outputLatency: (ctx as AudioContext & { outputLatency?: number }).outputLatency,
    });
    startHealthMonitor();
    void loadRing();            // preload in background; do not await
    void applySinkId();         // restore a previously chosen output device
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
export function installRearmNet(): void {
  if (rearmInstalled) return;
  rearmInstalled = true;

  const rearm = (): void => {
    if (armed && ctx && ctx.state === 'running') return;
    event('audio_rearm_triggered', { from: 'gesture' });
    void arm();
  };

  // capture:true so we see the event even if a handler stops propagation
  for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
    document.addEventListener(type, rearm, { capture: true, passive: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (ctx && ctx.state === 'suspended') {
      event('audio_rearm_triggered', { from: 'visibility' });
      ctx.resume().then(() => { armed = ctx!.state === 'running'; emit(); }).catch(() => emit());
    }
  });
}

function startHealthMonitor(): void {
  if (healthTimer) return;
  healthTimer = setInterval(() => {
    if (!ctx) return;
    const wasArmed = armed;

    if (ctx.state !== 'running') {
      armed = false;
      if (wasArmed) event('audio_context_lost', { state: ctx.state });
      ctx.resume()
        .then(() => {
          armed = ctx!.state === 'running';
          if (armed && !wasArmed) event('audio_context_recovered');
          emit();
        })
        .catch(() => emit());
    } else if (!wasArmed) {
      armed = true;
      emit();
    }
  }, CONFIG.healthIntervalMs);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Sound loading                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

let loadingPromise: Promise<AudioBuffer> | null = null;

async function loadRing(): Promise<AudioBuffer> {
  if (ringBuffer) return ringBuffer;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async (): Promise<AudioBuffer> => {
    try {
      if (!ctx) throw new Error('no_audio_context');
      const res = await fetch(CONFIG.ringUrl, { cache: 'force-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      ringBuffer = await ctx.decodeAudioData(await res.arrayBuffer());
      event('ring_buffer_loaded', { source: 'file', duration: ringBuffer.duration });
    } catch (err) {
      // Never let a network failure mean silence.
      console.warn('[order-alert] ring file unavailable, synthesising', err);
      ringBuffer = synthesiseRing();
      event('ring_buffer_loaded', { source: 'synth', reason: (err as Error).message });
    }
    emit();
    return ringBuffer!;
  })();

  return loadingPromise;
}

/**
 * Two-tone alternating ring, generated in memory.
 * 880–1175 Hz sits in the most sensitive part of human hearing and is what
 * cheap PC speakers actually reproduce.
 */
function synthesiseRing(): AudioBuffer {
  const sr = ctx!.sampleRate;
  const duration = 2.0;
  const buf = ctx!.createBuffer(1, Math.floor(duration * sr), sr);
  const data = buf.getChannelData(0);

  const TONE_MS = 0.40;
  const FADE = 0.015;

  for (let i = 0; i < data.length; i++) {
    const t = i / sr;
    const cycle = t % 1.0;

    if (cycle >= TONE_MS) { data[i] = 0; continue; }

    const freq = (t % 2.0) < 1.0 ? 880 : 1175;
    const fadeIn = Math.min(cycle / FADE, 1);
    const fadeOut = Math.min((TONE_MS - cycle) / FADE, 1);
    const env = Math.max(0, Math.min(fadeIn, fadeOut));

    data[i] = Math.sin(2 * Math.PI * freq * t) * 0.9 * env;
  }
  return buf;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Ringing                                                                    */
/* ══════════════════════════════════════════════════════════════════════════ */

export interface RingOptions {
  escalate?: boolean;
  volume?: number;
}

/**
 * Start ringing. Loops forever until stop() is called.
 * Returns false if audio was never armed — use this to
 * trigger your out-of-band fallback (SMS, call, push).
 */
export async function ring({ escalate = true, volume = 1.0 }: RingOptions = {}): Promise<boolean> {
  if (ringing) return true;   // idempotent: duplicate order events must not restart it

  // Lazy unlock (GUIDE §4): on machines where the restriction was removed
  // (browser policy, launch flag, installed PWA, desktop wrapper), audio is
  // allowed with zero interaction — so attempt the unlock here instead of
  // demanding a prior arm(). On a restricted machine with no gesture this
  // fails harmlessly and we fall through to the not_armed path (banner).
  // Without this, Layer 2 machines still asked for a click after every
  // refresh — the exact bug reported.
  if (!armed || !ctx || ctx.state !== 'running') {
    await arm();
  }

  if (!armed || !ctx) {
    event('ring_failed', { reason: 'not_armed', contextState: ctx ? ctx.state : 'none' });
    emit();
    return false;
  }

  const buf = await loadRing();

  if (ctx.state !== 'running') {
    try { await ctx.resume(); } catch { /* fall through, check below */ }
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

  // Transparent limiter: the ring file is already mastered to full scale,
  // so this only catches overshoots instead of squashing the sound.
  // (An aggressive compressor here would make a loud file quieter.)
  compNode = ctx.createDynamicsCompressor();
  compNode.threshold.value = 0;
  compNode.knee.value = 0;
  compNode.ratio.value = 20;
  compNode.attack.value = 0.002;
  compNode.release.value = 0.1;

  gainNode.connect(compNode);
  compNode.connect(ctx.destination);

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
 * Wire this to pendingOrders becoming empty (accept/reject path handles it
 * centrally in Dashboardlayout) — never to a timeout.
 */
export function stop(): void {
  if (!ringing) return;

  const duration = ringStartedAt ? Date.now() - ringStartedAt : 0;

  // 30ms fade so stopping doesn't produce an audible click
  if (gainNode && ctx) {
    const now = ctx.currentTime;
    try {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.03);
    } catch { /* ignore */ }
  }

  const toStop = sourceNode;
  const toDisconnect = gainNode;
  const toDisconnectComp = compNode;
  sourceNode = null;
  gainNode = null;
  compNode = null;
  ringing = false;
  ringStartedAt = null;

  setTimeout(() => {
    if (toStop) {
      try { toStop.stop(); } catch { /* ignore */ }
    }
    if (toStop) {
      try { toStop.disconnect(); } catch { /* ignore */ }
    }
    if (toDisconnect) {
      try { toDisconnect.disconnect(); } catch { /* ignore */ }
    }
    if (toDisconnectComp) {
      try { toDisconnectComp.disconnect(); } catch { /* ignore */ }
    }
  }, 40);

  event('ring_stopped', { durationMs: duration });
  emit();
}

/**
 * Short test beep for a "Test sound" button. Returns false if blocked,
 * which is exactly what you want to show the vendor.
 */
export async function selfTest(): Promise<boolean> {
  if (ringing) return true;              // already obviously working
  const ok = await ring({ escalate: false, volume: 1.0 });
  if (ok) setTimeout(stop, 1400);
  event(ok ? 'sound_test_played' : 'sound_test_failed');
  return ok;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Output device routing (Chrome 110+)                                        */
/* ══════════════════════════════════════════════════════════════════════════ */

async function applySinkId(): Promise<boolean> {
  if (!preferredSinkId) {
    try { preferredSinkId = localStorage.getItem('orderAlert.sinkId'); } catch { /* ignore */ }
  }
  const ctxWithSink = ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
  if (!preferredSinkId || !ctxWithSink || typeof ctxWithSink.setSinkId !== 'function') return false;
  try {
    await ctxWithSink.setSinkId(preferredSinkId);
    event('output_device_set', { deviceId: preferredSinkId });
    return true;
  } catch (err) {
    event('output_device_failed', { deviceId: preferredSinkId, message: (err as Error).message });
    preferredSinkId = null;
    try { localStorage.removeItem('orderAlert.sinkId'); } catch { /* ignore */ }
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Keep the machine awake during a shift                                      */
/* ══════════════════════════════════════════════════════════════════════════ */

type WakeLockSentinelLike = { released: boolean; release: () => Promise<void>; addEventListener: (t: string, fn: () => void) => void };
let wakeLock: WakeLockSentinelLike | null = null;

export async function holdScreenAwake(): Promise<boolean> {
  if (!('wakeLock' in navigator)) return false;

  const acquire = async (): Promise<boolean> => {
    try {
      const nav = navigator as Navigator & { wakeLock: { request: (t: string) => Promise<WakeLockSentinelLike> } };
      wakeLock = await nav.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => event('wake_lock_released'));
      event('wake_lock_acquired');
      return true;
    } catch (err) {
      event('wake_lock_failed', { message: (err as Error).message });
      return false;
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!wakeLock || wakeLock.released)) {
      void acquire();
    }
  });

  return acquire();
}

export function releaseScreenAwake(): void {
  if (wakeLock) {
    try { void wakeLock.release(); } catch { /* ignore */ }
  }
  wakeLock = null;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* Diagnostics                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Snapshot for your heartbeat payload and your "Check my setup" page. */
export function diagnostics(): DiagnosticsSnapshot {
  const displayMode = (['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen'] as const)
    .find(m => matchMedia(`(display-mode:${m})`).matches) || 'browser';
  const notif = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  return {
    ...getState(),
    secureContext: window.isSecureContext,
    displayMode,
    notificationPermission: notif,
    wakeLockSupported: 'wakeLock' in navigator,
    setSinkIdSupported: !!(ctx && typeof (ctx as unknown as { setSinkId?: unknown }).setSinkId === 'function'),
    sampleRate: ctx ? ctx.sampleRate : null,
    userAgent: navigator.userAgent,
    tabVisible: document.visibilityState === 'visible',
  };
}
