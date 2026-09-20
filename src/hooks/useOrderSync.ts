import { useCallback, useEffect, useRef } from "react";
import { useGetVendorOrdersQuery } from "../apis/orderApi";
import { useDashboardStore } from "../stores/useDashboardStore";
import { OrderStatusFilter } from "../types/filters";
import type { OrderSocketState } from "./useOrderWebsocket";

export const FAST_MS = 10_000;   // socket not proving itself -> REST carries latency
export const SLOW_MS = 30_000;   // socket recently delivered -> back off
export const TRUST_WINDOW_MS = 120_000;  // how long a socket delivery earns the slow rate

// At most one refetch per window, so a reconnect storm cannot fire a burst.
const RESYNC_DEBOUNCE_MS = 3000;

// Only the three dashboard columns. The unfiltered query returns the shop's entire order
// history, which is far too heavy to poll at FAST_MS across every vendor; this one is small.
const ACTIVE_STATUSES = [
  OrderStatusFilter.PENDING,
  OrderStatusFilter.ACCEPTED,
  OrderStatusFilter.READY_FOR_PICKUP,
];

// Derived from DELIVERY evidence, never from `isConnected`. Behind the Vercel rewrite proxy the
// socket honestly reports "connected" while still delivering ~25s late, so a connected-but-silent
// socket must keep the fast REST rate — otherwise it earns the slow rate and the latency returns.
export const pickInterval = (socket: OrderSocketState, now: number): number =>
  socket.lastMessageAt !== null && now - socket.lastMessageAt < TRUST_WINDOW_MS
    ? SLOW_MS
    : FAST_MS;

// Bounds how long a new order can stay invisible, independently of the socket. Runs alongside
// the dashboard's 45s full-history query, which stays the complete truth; this only accelerates
// the active set. Both feed the same `reconcile`.
export const useOrderSync = (shopId: string | null, socket: OrderSocketState) => {
  const reconcile = useDashboardStore((state) => state.reconcile);

  const { data, refetch } = useGetVendorOrdersQuery(
    { shopId: shopId ?? "", orderStatus: ACTIVE_STATUSES },
    {
      skip: !shopId,
      pollingInterval: pickInterval(socket, Date.now()),
    }
  );

  // Declared first so the listeners below always call the current refetch while staying
  // subscribed across renders.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useEffect(() => {
    if (data) reconcile(data);
  }, [data, reconcile]);

  const lastResyncRef = useRef(0);
  const resync = useCallback(() => {
    const now = Date.now();
    if (now - lastResyncRef.current < RESYNC_DEBOUNCE_MS) return;
    lastResyncRef.current = now;
    refetchRef.current();
  }, []);

  // A reconnect means orders may have been placed while the socket was down.
  const wasConnectedRef = useRef(socket.isConnected);
  useEffect(() => {
    if (shopId && socket.isConnected && !wasConnectedRef.current) resync();
    wasConnectedRef.current = socket.isConnected;
  }, [shopId, socket.isConnected, resync]);

  useEffect(() => {
    if (!shopId) return;

    const onVisible = () => {
      if (document.visibilityState === "visible") resync();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", resync);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", resync);
    };
  }, [shopId, resync]);
};
