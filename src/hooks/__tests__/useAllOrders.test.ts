import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerMock } = vi.hoisted(() => ({ triggerMock: vi.fn() }));
vi.mock("../../apis/orderApi", () => ({ useLazyGetVendorOrdersPageQuery: () => [triggerMock] }));

const pageOf = (page: number, totalPages: number, prefix = "P") => ({
  unwrap: () => Promise.resolve({ orders: [{ orderId: `${prefix}${page}` }], totalPages }),
});

// The kept copy lives in the module, so every test gets a fresh one.
const freshHook = async () => (await import("../useAllOrders")).useAllOrders;

beforeEach(() => {
  vi.resetModules();
  triggerMock.mockReset();
});

afterEach(cleanup);

describe("useAllOrders", () => {
  it("TC1: loads every page of the shop's whole history", async () => {
    triggerMock.mockImplementation((args: { page: number }) => pageOf(args.page, 3));
    const useAllOrders = await freshHook();
    const { result } = renderHook(() => useAllOrders("SHOP1"));

    await waitFor(() => expect(result.current.orders).not.toBeNull());
    expect(result.current.orders?.map((o) => o.orderId)).toEqual(["P0", "P1", "P2"]);
    expect(triggerMock.mock.calls.map((c) => c[0])).toEqual([
      { shopId: "SHOP1", page: 0 },
      { shopId: "SHOP1", page: 1 },
      { shopId: "SHOP1", page: 2 },
    ]);
    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loadedAt).toBeInstanceOf(Date);
  });

  it("TC2: coming back to the page reuses the loaded copy", async () => {
    triggerMock.mockImplementation((args: { page: number }) => pageOf(args.page, 1));
    const useAllOrders = await freshHook();
    const first = renderHook(() => useAllOrders("SHOP1"));
    await waitFor(() => expect(first.result.current.orders).not.toBeNull());
    first.unmount();

    const again = renderHook(() => useAllOrders("SHOP1"));
    expect(again.result.current.orders?.map((o) => o.orderId)).toEqual(["P0"]);
    expect(triggerMock).toHaveBeenCalledTimes(1);
  });

  it("TC3: two callers at once share a single load", async () => {
    triggerMock.mockImplementation((args: { page: number }) => pageOf(args.page, 1));
    const useAllOrders = await freshHook();
    const a = renderHook(() => useAllOrders("SHOP1"));
    const b = renderHook(() => useAllOrders("SHOP1"));
    await waitFor(() => expect(b.result.current.orders).not.toBeNull());
    expect(a.result.current.orders).toEqual(b.result.current.orders);
    expect(triggerMock).toHaveBeenCalledTimes(1);
  });

  it("TC4: a failed page shows an error, and reload retries", async () => {
    triggerMock.mockImplementation(() => ({ unwrap: () => Promise.reject({ status: 500 }) }));
    const useAllOrders = await freshHook();
    const { result } = renderHook(() => useAllOrders("SHOP1"));
    await waitFor(() => expect(result.current.error).toBe("network or server error"));
    expect(result.current.orders).toBeNull();

    triggerMock.mockImplementation((args: { page: number }) => pageOf(args.page, 1));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.orders?.map((o) => o.orderId)).toEqual(["P0"]));
    expect(result.current.error).toBeNull();
  });

  it("TC4: the page cap message comes through as the error", async () => {
    triggerMock.mockImplementation(() => pageOf(0, 500));
    const useAllOrders = await freshHook();
    const { result } = renderHook(() => useAllOrders("SHOP1"));
    await waitFor(() => expect(result.current.error).toMatch(/too many orders \(500 pages\)/));
  });

  it("TC5: no shop, no request", async () => {
    const useAllOrders = await freshHook();
    const { result } = renderHook(() => useAllOrders(null));
    expect(result.current.orders).toBeNull();
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("TC6: reload fetches again and replaces the kept copy", async () => {
    triggerMock.mockImplementation((args: { page: number }) => pageOf(args.page, 1));
    const useAllOrders = await freshHook();
    const { result } = renderHook(() => useAllOrders("SHOP1"));
    await waitFor(() => expect(result.current.orders).not.toBeNull());

    triggerMock.mockImplementation((args: { page: number }) => pageOf(args.page, 1, "NEW"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.orders?.map((o) => o.orderId)).toEqual(["NEW0"]));
    expect(triggerMock).toHaveBeenCalledTimes(2);
  });

  it("a slower load for the previous shop never lands as the new shop's data", async () => {
    const pending: Record<string, (page: unknown) => void> = {};
    triggerMock.mockImplementation((args: { shopId: string }) => ({
      unwrap: () => new Promise((resolve) => (pending[args.shopId] = resolve)),
    }));
    const useAllOrders = await freshHook();
    const shop1 = renderHook(() => useAllOrders("SHOP1"));
    shop1.unmount(); // logged out mid-load, without a page reload
    const shop2 = renderHook(() => useAllOrders("SHOP2"));

    await act(async () => pending.SHOP1({ orders: [{ orderId: "SHOP1-ORDER" }], totalPages: 1 }));
    expect(shop2.result.current.orders).toBeNull();
    expect(shop2.result.current.progress).not.toBeNull(); // SHOP2 is still loading

    await act(async () => pending.SHOP2({ orders: [{ orderId: "SHOP2-ORDER" }], totalPages: 1 }));
    expect(shop2.result.current.orders?.map((o) => o.orderId)).toEqual(["SHOP2-ORDER"]);
    expect(triggerMock.mock.calls.filter((c) => c[0].shopId === "SHOP2")).toHaveLength(1);
  });

  it("never returns another shop's orders", async () => {
    triggerMock.mockImplementation((args: { page: number }) => pageOf(args.page, 1));
    const useAllOrders = await freshHook();
    const first = renderHook(() => useAllOrders("SHOP1"));
    await waitFor(() => expect(first.result.current.orders).not.toBeNull());

    triggerMock.mockImplementation(() => ({ unwrap: () => new Promise(() => {}) })); // SHOP2 never answers
    const other = renderHook(() => useAllOrders("SHOP2"));
    expect(other.result.current.orders).toBeNull();
  });
});
