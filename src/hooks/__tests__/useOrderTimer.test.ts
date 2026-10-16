import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOrderTimer } from "../useOrderTimer";

const NOW = new Date("2026-10-16T10:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("useOrderTimer", () => {
  it("shows --:-- for a missing or unreadable start time", () => {
    expect(renderHook(() => useOrderTimer(undefined, "UP")).result.current.displayTime).toBe("--:--");
    expect(renderHook(() => useOrderTimer("not a date", "DOWN", 15)).result.current.displayTime).toBe("--:--");
  });

  it("UP counts from the start time, right from the first render, and ticks every second", () => {
    const { result } = renderHook(() => useOrderTimer("2026-10-16T09:58:55.000Z", "UP"));
    expect(result.current.displayTime).toBe("01:05");
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.displayTime).toBe("01:06");
  });

  it("UP shows hours once past an hour, and never goes negative", () => {
    expect(renderHook(() => useOrderTimer("2026-10-16T07:59:55.000Z", "UP")).result.current.displayTime).toBe("02:00:05");
    expect(renderHook(() => useOrderTimer("2026-10-16T10:00:30.000Z", "UP")).result.current.displayTime).toBe("00:00");
  });

  it("reads unix-ms strings and the backend's space-separated format", () => {
    expect(renderHook(() => useOrderTimer(String(NOW.getTime() - 5000), "UP")).result.current.displayTime).toBe("00:05");
    const local = new Date(NOW.getTime() - 10_000);
    const p = (n: number) => String(n).padStart(2, "0");
    const spaced = `${local.getFullYear()}-${p(local.getMonth() + 1)}-${p(local.getDate())} ${p(local.getHours())}:${p(local.getMinutes())}:${p(local.getSeconds())}`;
    expect(renderHook(() => useOrderTimer(spaced, "UP")).result.current.displayTime).toBe("00:10");
  });

  it("DOWN counts down the prep time and stops at 00:00", () => {
    const { result } = renderHook(() => useOrderTimer("2026-10-16T10:00:00.000Z", "DOWN", 15));
    expect(result.current.displayTime).toBe("15:00");
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.displayTime).toBe("14:00");
    act(() => vi.advanceTimersByTime(15 * 60_000));
    expect(result.current.displayTime).toBe("00:00");
  });

  it("follows a new start time at once (e.g. acceptedDate arriving after creationTime)", () => {
    const { result, rerender } = renderHook(({ start }) => useOrderTimer(start, "DOWN", 10), {
      initialProps: { start: "2026-10-16T09:55:00.000Z" },
    });
    expect(result.current.displayTime).toBe("05:00");
    rerender({ start: "2026-10-16T10:00:00.000Z" });
    expect(result.current.displayTime).toBe("10:00");
    rerender({ start: undefined as unknown as string });
    expect(result.current.displayTime).toBe("--:--");
  });
});
