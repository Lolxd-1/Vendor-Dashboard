import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderStatusFilter } from "../../types/filters";
import type { OrderSocketState } from "../useOrderWebsocket";
import {
  FAST_MS,
  SLOW_MS,
  TRUST_WINDOW_MS,
  pickInterval,
  useOrderSync,
} from "../useOrderSync";

// RTK Query is the process boundary here: the hook's job is which interval and when to refetch,
// not how the request is made. `queryMock` records the args `useOrderSync` passes.
const { queryMock, refetchSpy } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  refetchSpy: vi.fn(),
}));

vi.mock("../../apis/orderApi", () => ({
  useGetVendorOrdersQuery: queryMock,
}));

const socketState = (
  isConnected: boolean,
  lastMessageAt: number | null
): OrderSocketState => ({ isConnected, lastMessageAt });

const queryOptions = () => queryMock.mock.calls[0][1];
const queryArgs = () => queryMock.mock.calls[0][0];

beforeEach(() => {
  // setup.ts does not clear sessionStorage between tests, and `reconcile` prunes the print ledger.
  sessionStorage.clear();
  queryMock.mockReset();
  refetchSpy.mockReset();
  queryMock.mockReturnValue({ data: undefined, refetch: refetchSpy });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pickInterval — poll rate derived from delivery evidence", () => {
  const now = 1_700_000_000_000;

  it("TC1: a socket that has never delivered gets the fast rate, and fast is at most 10s", () => {
    expect(pickInterval(socketState(false, null), now)).toBe(FAST_MS);
    expect(FAST_MS).toBeLessThanOrEqual(10_000);
  });

  it("TC2: a delivery 5s ago earns the slow rate", () => {
    expect(pickInterval(socketState(true, now - 5_000), now)).toBe(SLOW_MS);
  });

  it("TC3: trust expires — a delivery 3 minutes ago is back to the fast rate", () => {
    expect(pickInterval(socketState(true, now - 180_000), now)).toBe(FAST_MS);
  });

  it("TC4: connected but never delivered must NOT earn the slow rate (the Vercel case)", () => {
    // Through the Vercel rewrite proxy the socket reports connected while SockJS long-polls at
    // ~25s. Keying the rate off `isConnected` here would reintroduce the ~30s latency.
    expect(pickInterval(socketState(true, null), now)).toBe(FAST_MS);
    expect(pickInterval(socketState(true, null), now)).not.toBe(SLOW_MS);
  });

  it("TC5: exactly TRUST_WINDOW_MS ago counts as expired", () => {
    expect(pickInterval(socketState(true, now - TRUST_WINDOW_MS), now)).toBe(FAST_MS);
  });

  it("TC6: the fast rate keeps 200 vendors within the active-set request budget", () => {
    const VENDORS = 200;
    const MAX_REQUESTS_PER_SECOND = 25;

    const requestsPerSecond = VENDORS / (FAST_MS / 1000);

    expect(requestsPerSecond).toBeLessThanOrEqual(MAX_REQUESTS_PER_SECOND);
    // The same budget expressed as the floor it puts under the interval.
    expect(FAST_MS).toBeGreaterThanOrEqual((VENDORS / MAX_REQUESTS_PER_SECOND) * 1000);
    expect(FAST_MS).toBeGreaterThanOrEqual(8000);
  });
});

describe("useOrderSync — resync triggers", () => {
  it("TC7: a burst of triggers collapses into one refetch, the next window allows another", () => {
    vi.useFakeTimers();
    renderHook(() => useOrderSync("SHOP-1", socketState(false, null)));

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
      window.dispatchEvent(new Event("online"));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(refetchSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1500); // 3500ms since the first trigger
      window.dispatchEvent(new Event("online"));
    });

    expect(refetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refetches immediately when the socket transitions disconnected -> connected", () => {
    const { rerender } = renderHook(
      ({ socket }: { socket: OrderSocketState }) => useOrderSync("SHOP-1", socket),
      { initialProps: { socket: socketState(false, null) } }
    );

    expect(refetchSpy).not.toHaveBeenCalled();

    rerender({ socket: socketState(true, null) });

    expect(refetchSpy).toHaveBeenCalledTimes(1);

    // Staying connected is not a new transition.
    rerender({ socket: socketState(true, null) });
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it("TC8: unmounting removes the visibilitychange and online listeners", () => {
    const docAdd = vi.spyOn(document, "addEventListener");
    const docRemove = vi.spyOn(document, "removeEventListener");
    const winAdd = vi.spyOn(window, "addEventListener");
    const winRemove = vi.spyOn(window, "removeEventListener");

    const countFor = (spy: typeof docAdd, event: string) =>
      spy.mock.calls.filter((call) => call[0] === event).length;

    const { unmount } = renderHook(() => useOrderSync("SHOP-1", socketState(false, null)));

    expect(countFor(docAdd, "visibilitychange")).toBe(1);
    expect(countFor(winAdd, "online")).toBe(1);

    unmount();

    expect(countFor(docRemove, "visibilitychange")).toBe(countFor(docAdd, "visibilitychange"));
    expect(countFor(winRemove, "online")).toBe(countFor(winAdd, "online"));
  });
});

describe("useOrderSync — query shape", () => {
  it("TC9: a null shopId issues no query", () => {
    renderHook(() => useOrderSync(null, socketState(false, null)));

    expect(queryOptions().skip).toBe(true);
  });

  it("TC10: the poll is restricted to the three active statuses", () => {
    renderHook(() => useOrderSync("SHOP-1", socketState(false, null)));

    const { shopId, orderStatus } = queryArgs();

    expect(shopId).toBe("SHOP-1");
    expect(orderStatus).toEqual([
      OrderStatusFilter.PENDING,
      OrderStatusFilter.ACCEPTED,
      OrderStatusFilter.READY_FOR_PICKUP,
    ]);
    expect(orderStatus).not.toContain(OrderStatusFilter.COMPLETED);
    expect(orderStatus).not.toContain(OrderStatusFilter.REJECTED);
    expect(orderStatus).not.toContain(OrderStatusFilter.CANCELLED);
    expect(queryOptions().skip).toBe(false);
  });

  it("polls at the fast rate while the socket has delivered nothing", () => {
    renderHook(() => useOrderSync("SHOP-1", socketState(true, null)));

    expect(queryOptions().pollingInterval).toBe(FAST_MS);
  });
});
