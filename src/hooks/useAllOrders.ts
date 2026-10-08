import { useCallback, useEffect } from "react";
import { create } from "zustand";
import type { Order } from "../types/order";
import { useLazyGetVendorOrdersPageQuery, type VendorOrdersPage } from "../apis/orderApi";
import { fetchAllOrderPages } from "../utils/fetchAllOrderPages";

// Analytics needs the shop's whole history (new vs returning customers, cohorts, past
// settlement weeks), so every page is loaded once and kept for the session: switching
// periods or leaving and coming back costs no request. "Refresh" loads it again.

interface Progress {
  loaded: number;
  total: number;
}

interface AllOrdersState {
  shopId: string | null;
  orders: Order[] | null;
  loadedAt: Date | null;
  error: string | null;
  progress: Progress | null;
}

const useAllOrdersStore = create<AllOrdersState>(() => ({
  shopId: null,
  orders: null,
  loadedAt: null,
  error: null,
  progress: null,
}));

// The load whose results may still be written. StrictMode's double effect or two callers
// share it; a newer load (e.g. another shop logged in without a page reload) replaces it,
// and the older one's late results are then dropped instead of landing as the new shop's.
let current: { shopId: string } | null = null;

const load = (shopId: string, fetchPage: (page: number) => Promise<VendorOrdersPage>, force: boolean) => {
  const state = useAllOrdersStore.getState();
  if (current?.shopId === shopId || (!force && state.shopId === shopId && state.orders)) return;
  const ticket = { shopId };
  current = ticket;
  const write = (partial: Partial<AllOrdersState>) => {
    if (current === ticket) useAllOrdersStore.setState(partial);
  };
  useAllOrdersStore.setState({
    ...(state.shopId === shopId ? {} : { shopId, orders: null, loadedAt: null }),
    error: null,
    progress: { loaded: 0, total: 1 },
  });

  fetchAllOrderPages(fetchPage, (loaded, total) => write({ progress: { loaded, total } }))
    .then((orders) => write({ orders, loadedAt: new Date(), progress: null }))
    .catch((err: unknown) =>
      write({ error: err instanceof Error ? err.message : "network or server error", progress: null })
    )
    .finally(() => {
      if (current === ticket) current = null;
    });
};

export const useAllOrders = (shopId: string | null) => {
  const [trigger] = useLazyGetVendorOrdersPageQuery();
  const fetchPage = useCallback(
    // No status or time filter: the backend then returns the shop's entire history.
    (page: number) => trigger({ shopId: shopId ?? "", page }).unwrap(),
    [trigger, shopId]
  );

  useEffect(() => {
    if (shopId) load(shopId, fetchPage, false);
  }, [shopId, fetchPage]);

  const reload = useCallback(() => {
    if (shopId) load(shopId, fetchPage, true);
  }, [shopId, fetchPage]);

  const mine = useAllOrdersStore((s) => s.shopId === shopId && shopId !== null);
  const orders = useAllOrdersStore((s) => s.orders);
  const loadedAt = useAllOrdersStore((s) => s.loadedAt);
  const error = useAllOrdersStore((s) => s.error);
  const progress = useAllOrdersStore((s) => s.progress);

  return mine
    ? { orders, loadedAt, error, progress, reload }
    : { orders: null, loadedAt: null, error: null, progress: null, reload };
};
