import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Accept → stop() must silence the ring even when it lands while ring() is
// still awaiting the ring file, and overlapping ring() calls must not leave
// an orphaned looping source that stop() can no longer reach.

type FakeSource = { loop: boolean; started: boolean; stopped: boolean };
let sources: FakeSource[] = [];
let releaseFetch: () => void = () => {};

class FakeAudioContext {
  state = "running";
  sampleRate = 44100;
  currentTime = 0;
  destination = {};
  resume() { return Promise.resolve(); }
  createBuffer(_c: number, n: number) { return { duration: 1, getChannelData: () => new Float32Array(n) }; }
  decodeAudioData() { return Promise.resolve(this.createBuffer(1, 1)); }
  createBufferSource() {
    const s: FakeSource & Record<string, unknown> = {
      loop: false, started: false, stopped: false, buffer: null,
      connect() {}, disconnect() {},
      start() { s.started = true; },
      stop() { s.stopped = true; },
    };
    sources.push(s);
    return s;
  }
  createGain() {
    return {
      gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
      connect() {}, disconnect() {},
    };
  }
  createDynamicsCompressor() {
    const p = () => ({ value: 0 });
    return { threshold: p(), knee: p(), ratio: p(), attack: p(), release: p(), connect() {}, disconnect() {} };
  }
}

const stillRinging = () => sources.filter((s) => s.loop && s.started && !s.stopped);
const settle = () => new Promise((r) => setTimeout(r, 60));

beforeEach(() => {
  sources = [];
  vi.resetModules();
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => {
    releaseFetch = () => resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("order-alert ring/stop races", () => {
  it("stop() while ring() is still loading the sound → nothing keeps ringing", async () => {
    const Alert = await import("../order-alert");
    const ringing = Alert.ring({ escalate: true });
    await Promise.resolve();
    Alert.stop();            // order accepted before the ring file arrived
    releaseFetch();
    await ringing;
    await settle();
    expect(stillRinging()).toHaveLength(0);
    expect(Alert.getState().ringing).toBe(false);
  });

  it("overlapping ring() calls start ONE source, and stop() silences it", async () => {
    const Alert = await import("../order-alert");
    const a = Alert.ring({ escalate: true });
    const b = Alert.ring({ escalate: true });   // poll/socket update re-runs the effect
    await new Promise((r) => setTimeout(r, 0));
    releaseFetch();
    await Promise.all([a, b]);
    expect(sources.filter((s) => s.loop && s.started)).toHaveLength(1);
    Alert.stop();
    await settle();
    expect(stillRinging()).toHaveLength(0);
  });

  it("a new order after a cancelled start still rings", async () => {
    const Alert = await import("../order-alert");
    const first = Alert.ring({ escalate: true });
    await Promise.resolve();
    Alert.stop();
    const second = Alert.ring({ escalate: true });
    releaseFetch();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(stillRinging()).toHaveLength(1);
    expect(Alert.getState().ringing).toBe(true);
    Alert.stop();
    await settle();
    expect(stillRinging()).toHaveLength(0);
  });
});
