import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The vendor's volume slider scales the ring and nothing else. With nothing
// saved the ring must be exactly as loud as before the slider existed.

type GainCall = [string, number];
let gainCalls: GainCall[] = [];

class FakeAudioContext {
  state = "running";
  sampleRate = 44100;
  currentTime = 0;
  destination = {};
  resume() { return Promise.resolve(); }
  createBuffer(_c: number, n: number) { return { duration: 1, getChannelData: () => new Float32Array(n) }; }
  decodeAudioData() { return Promise.resolve(this.createBuffer(1, 1)); }
  createBufferSource() {
    return { loop: false, buffer: null, connect() {}, disconnect() {}, start() {}, stop() {} };
  }
  createGain() {
    return {
      gain: {
        value: 1,
        setValueAtTime(v: number) { gainCalls.push(["set", v]); },
        linearRampToValueAtTime(v: number) { gainCalls.push(["ramp", v]); },
        cancelScheduledValues() { gainCalls.push(["cancel", NaN]); },
      },
      connect() {}, disconnect() {},
    };
  }
  createDynamicsCompressor() {
    const p = () => ({ value: 0 });
    return { threshold: p(), knee: p(), ratio: p(), attack: p(), release: p(), connect() {}, disconnect() {} };
  }
}

const loadAlert = () => import("../order-alert");

beforeEach(() => {
  gainCalls = [];
  localStorage.clear();
  vi.resetModules();   // fresh module state: the saved volume is read once per page load
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
  ));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("order-alert volume", () => {
  it("nothing saved -> full volume, ring gain exactly as before the slider", async () => {
    const Alert = await loadAlert();
    expect(Alert.getVolume()).toBe(1);
    expect(await Alert.ring({ escalate: true })).toBe(true);
    expect(gainCalls).toEqual([["set", 1], ["ramp", 1]]);
    Alert.stop();
  });

  it("a saved volume survives a reload and scales the ring", async () => {
    (await loadAlert()).setVolume(0.4);
    expect(localStorage.getItem("orderAlert.volume")).toBe("0.4");

    vi.resetModules();   // page reload
    const Alert = await loadAlert();
    expect(Alert.getVolume()).toBe(0.4);
    await Alert.ring({ escalate: true });
    expect(gainCalls).toEqual([["set", 0.4], ["ramp", 0.4]]);
    Alert.stop();
  });

  it("never goes below 10% or above 100%", async () => {
    const Alert = await loadAlert();
    Alert.setVolume(0);
    expect(Alert.getVolume()).toBe(Alert.MIN_VOLUME);
    expect(Alert.MIN_VOLUME).toBe(0.1);
    Alert.setVolume(-3);
    expect(Alert.getVolume()).toBe(0.1);
    Alert.setVolume(5);
    expect(Alert.getVolume()).toBe(1);
    Alert.setVolume(NaN);
    expect(Alert.getVolume()).toBe(1);
  });

  it.each([["0", 0.1], ["abc", 1], ["", 1], ["7", 1]])(
    "saved value %j is read as %d",
    async (raw, expected) => {
      localStorage.setItem("orderAlert.volume", raw);
      expect((await loadAlert()).getVolume()).toBe(expected);
    }
  );

  it("moving the slider during a ring changes the live ring immediately", async () => {
    const Alert = await loadAlert();
    await Alert.ring({ escalate: true });
    gainCalls = [];
    Alert.setVolume(0.3);
    expect(gainCalls).toEqual([["cancel", NaN], ["set", 0.3]]);
    Alert.stop();
  });

  it("moving the slider while silent touches no audio", async () => {
    const Alert = await loadAlert();
    Alert.setVolume(0.3);
    expect(gainCalls).toEqual([]);
  });

  it("Test sound plays at the chosen volume", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const Alert = await loadAlert();
      Alert.setVolume(0.5);
      expect(await Alert.selfTest()).toBe(true);
      expect(gainCalls).toEqual([["set", 0.5]]);
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocked storage never silences the ring: full volume, no throw", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const Alert = await loadAlert();
    expect(Alert.getVolume()).toBe(1);
    expect(await Alert.ring({ escalate: true })).toBe(true);
    expect(gainCalls).toEqual([["set", 1], ["ramp", 1]]);
    expect(() => Alert.setVolume(0.5)).not.toThrow();
    Alert.stop();
  });
});
