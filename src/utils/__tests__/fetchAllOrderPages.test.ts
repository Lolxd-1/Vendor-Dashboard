import { describe, expect, it, vi } from "vitest";
import { fetchAllOrderPages, MAX_PAGES } from "../fetchAllOrderPages";
import type { Order } from "../../types/order";
import type { VendorOrdersPage } from "../../apis/orderApi";

const orders = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ orderId: `O${from + i}` })) as unknown as Order[];

// Fake backend: `total` orders, 50 per page, like the real one.
const backend = (total: number) =>
  vi.fn(async (page: number): Promise<VendorOrdersPage> => ({
    orders: orders(page * 50, Math.max(0, Math.min(50, total - page * 50))),
    totalPages: Math.ceil(total / 50),
  }));

describe("fetchAllOrderPages", () => {
  it("collects every page — the 386-order week comes back complete", async () => {
    const fetchPage = backend(386);
    const all = await fetchAllOrderPages(fetchPage);
    expect(all).toHaveLength(386);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(all.map((o) => o.orderId)).size).toBe(386);
  });

  it("a filter with 50 or fewer orders makes exactly one request", async () => {
    const fetchPage = backend(5);
    expect(await fetchAllOrderPages(fetchPage)).toHaveLength(5);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("no orders: one request, empty result", async () => {
    const fetchPage = vi.fn(async () => ({ orders: [], totalPages: 0 }));
    expect(await fetchAllOrderPages(fetchPage)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("reports progress page by page", async () => {
    const progress = vi.fn();
    await fetchAllOrderPages(backend(120), progress);
    expect(progress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("an order that shifts onto the next page (new order arrived) is kept once", async () => {
    const fetchPage = vi.fn(async (page: number) =>
      page === 0
        ? { orders: orders(0, 50), totalPages: 2 }
        : { orders: [...orders(49, 1), ...orders(50, 10)], totalPages: 2 } // O49 repeated
    );
    const all = await fetchAllOrderPages(fetchPage);
    expect(all).toHaveLength(60);
    expect(all.filter((o) => o.orderId === "O49")).toHaveLength(1);
  });

  it("stops early if a page comes back empty", async () => {
    const fetchPage = vi.fn(async (page: number) =>
      page === 0 ? { orders: orders(0, 50), totalPages: 5 } : { orders: [], totalPages: 5 }
    );
    expect(await fetchAllOrderPages(fetchPage)).toHaveLength(50);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("any failed page fails the whole call — no partial data", async () => {
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 2) throw new Error("network down");
      return { orders: orders(page * 50, 50), totalPages: 4 };
    });
    await expect(fetchAllOrderPages(fetchPage)).rejects.toThrow("network down");
  });

  it("refuses absurdly large ranges before loading them", async () => {
    const fetchPage = vi.fn(async () => ({ orders: orders(0, 50), totalPages: MAX_PAGES + 1 }));
    await expect(fetchAllOrderPages(fetchPage)).rejects.toThrow(/pick a shorter time period/);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("all time for the real test shop (3,227 orders, 65 pages) is within the cap", async () => {
    expect(await fetchAllOrderPages(backend(3227))).toHaveLength(3227);
  });
});
