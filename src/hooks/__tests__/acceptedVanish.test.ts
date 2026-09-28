import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRACE_MS, useDashboardStore } from "../../stores/useDashboardStore";
import type { Order } from "../../types/order";
import { useOrderSync } from "../useOrderSync";

// THE BUG: an accepted order vanished from the board a few minutes after
// accept and only came back on refresh. RTK Query keeps the SAME `data`
// reference while a poll returns identical content, so the list that holds
// the order stopped re-confirming it; the other list (which does not hold it)
// then changed, found it older than GRACE_MS, and deleted it.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../apis/orderApi", () => ({ useGetVendorOrdersQuery: queryMock }));

const accepted = { orderId: "QV-ACC", state: "ACCEPTED", orderItem: [] } as unknown as Order;
const activeList = [accepted];   // identical content on every poll -> same reference
const socket = { isConnected: true, lastMessageAt: null };

beforeEach(() => {
  sessionStorage.clear();
  useDashboardStore.getState().clearAll();
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("accepted order stays on the board while the active poll keeps listing it", () => {
  it("an unchanged poll result still re-confirms the order, so another list cannot age it out", () => {
    queryMock.mockReturnValue({ data: activeList, fulfilledTimeStamp: Date.now(), refetch: vi.fn() });
    const { rerender } = renderHook(() => useOrderSync("shop-1", socket));
    expect(useDashboardStore.getState().acceptedOrders.map((o) => o.orderId)).toEqual(["QV-ACC"]);

    // Polls keep landing every 30s with identical content (same `data` ref).
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(30_000);
      queryMock.mockReturnValue({ data: activeList, fulfilledTimeStamp: Date.now(), refetch: vi.fn() });
      rerender();
    }
    expect(Date.now() - 1_700_000_000_000).toBeGreaterThan(GRACE_MS);

    // The 45s full query changes for an unrelated reason and does not hold the order.
    useDashboardStore.getState().reconcile([
      { orderId: "OLD-1", state: "COMPLETED", orderItem: [] } as unknown as Order,
    ]);

    expect(useDashboardStore.getState().acceptedOrders.map((o) => o.orderId)).toEqual(["QV-ACC"]);
  });
});
