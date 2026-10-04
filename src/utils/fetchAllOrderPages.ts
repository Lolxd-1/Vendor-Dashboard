// The backend answers Order History 50 orders at a time (newest first). Export and
// Print Items need EVERY order of the selected filter, so this walks the pages one
// by one. Any failure rejects the whole call: callers never act on partial data.
import type { Order } from "../types/order";
import type { VendorOrdersPage } from "../apis/orderApi";

// 200 pages = 10,000 orders. Far above a normal week; stops a runaway request.
export const MAX_PAGES = 200;

export const fetchAllOrderPages = async (
  fetchPage: (page: number) => Promise<VendorOrdersPage>,
  onProgress?: (loaded: number, total: number) => void,
  maxPages: number = MAX_PAGES
): Promise<Order[]> => {
  const first = await fetchPage(0);
  const total = Math.max(1, first.totalPages);
  if (total > maxPages) {
    throw new Error(`too many orders (${total} pages) — pick a shorter time period`);
  }

  // A new order arriving mid-way pushes the list down by one, so the next page can
  // repeat an order we already have. Keep the first copy of each order id.
  const seen = new Set<string>();
  const all: Order[] = [];
  const add = (orders: Order[]) =>
    orders.forEach((o) => {
      const id = o.orderId ? String(o.orderId) : "";
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
      all.push(o);
    });

  add(first.orders);
  onProgress?.(1, total);
  for (let page = 1; page < total; page++) {
    const next = await fetchPage(page);
    if (next.orders.length === 0) break;
    add(next.orders);
    onProgress?.(page + 1, total);
  }
  return all;
};
