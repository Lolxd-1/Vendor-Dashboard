import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import BottomNav from "../components/BottomNav";
import SoundStatusChip from "../components/SoundStatusChip";
import { useOrderWebsocket } from "../hooks/useOrderWebsocket";
import { useDashboardStore } from "../stores/useDashboardStore";
import * as Alert from "../utils/order-alert";

declare global {
  interface Window {
    vendorShell?: {
      isDesktopApp: boolean;
      notifyNewOrder: (order: unknown) => void;
      notifyAcknowledged: () => void;
    };
  }
}

const BASE_TITLE = "QuickVerse Vendor";

const Layout = () => {
  const socket = useOrderWebsocket();
  const { isConnected } = socket;

  const [ringBlocked, setRingBlocked] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const pendingOrders = useDashboardStore((state) => state.pendingOrders);

  // Dedupe secondary channels (title flash / notification / shell) by order ID.
  // Audio itself is idempotent inside Alert.ring(). (§6.6)
  const seenRef = useRef<Set<string>>(new Set());
  const flashTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTitleFlash = () => {
    if (flashTimerRef.current) return;
    let flip = false;
    flashTimerRef.current = setInterval(() => {
      flip = !flip;
      document.title = flip ? "🔔 NEW ORDER" : BASE_TITLE;
    }, 700);
  };

  const stopTitleFlash = () => {
    if (flashTimerRef.current) {
      clearInterval(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    document.title = BASE_TITLE;
  };

  const notifyDesktop = (count: number) => {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("New order", {
          body: `${count} pending order${count === 1 ? "" : "s"} waiting — open the dashboard to accept.`,
          requireInteraction: true, // stays until dismissed (§3.9)
          tag: "vendor-new-order", // replaces rather than stacks
        });
      }
    } catch {
      /* notifications are reinforcement, never mechanism */
    }
  };

  // ─── Ring-until-acknowledged (§3.4) ───
  // pendingOrders.length > 0 → ring (loops, escalating volume).
  // pendingOrders.length === 0 → stop. Nothing else stops the ring —
  // no timeout, no visibility handler, no dismiss button.
  useEffect(() => {
    const hasUnviewedOrders = pendingOrders.length > 0;

    if (!hasUnviewedOrders) {
      void Alert.stop();
      // NOTE: ringBlocked is intentionally NOT reset here (react-hooks
      // set-state-in-effect). The banner renders only when
      // `ringBlocked && pendingOrders.length > 0`, so a stale `true`
      // hides itself, and the next order re-runs ring() and refreshes it.
      stopTitleFlash();
      try { window.vendorShell?.notifyAcknowledged(); } catch { /* ignore */ }
      return;
    }

    // Secondary channels for orders we haven't announced yet.
    const fresh = pendingOrders.filter((o) => !seenRef.current.has(o.orderId));
    for (const o of fresh) seenRef.current.add(o.orderId);
    if (fresh.length > 0) {
      startTitleFlash();
      notifyDesktop(pendingOrders.length);
      try { window.vendorShell?.notifyNewOrder(fresh[0]); } catch { /* ignore */ }
    }
    // Prune IDs that are no longer pending so a re-created order can ring again.
    const stillPending = new Set(pendingOrders.map((o) => o.orderId));
    for (const id of [...seenRef.current]) {
      if (!stillPending.has(id)) seenRef.current.delete(id);
    }

    let cancelled = false;
    void (async () => {
      const ok = await Alert.ring({ escalate: true });
      if (!cancelled) setRingBlocked(!ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingOrders]);

  // Re-check on tab visible (covers reconnect/backfill arriving while hidden).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && pendingOrders.length > 0) {
        void Alert.ring({ escalate: true }).then((ok) => setRingBlocked(!ok));
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onVis);
    };
  }, [pendingOrders.length]);

  // Cleanup title AND the ring on unmount. Mount-scoped on purpose: hanging
  // Alert.stop() off the [pendingOrders] effect would silence the ring on every
  // poll. The forced-expiry logout unmounts Layout with orders still pending,
  // and the ring loops in module state — this is its only reachable stop.
  useEffect(() => () => {
    void Alert.stop();
    stopTitleFlash();
  }, []);

  const handleEnableSound = async () => {
    const armed = await Alert.arm();
    if (armed && pendingOrders.length > 0) {
      const ok = await Alert.ring({ escalate: true });
      setRingBlocked(!ok);
    } else {
      setRingBlocked(!armed);
    }
  };

  const statusStrip = (
    <div className="flex items-center gap-3 px-3 lg:px-5 py-1.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/60">
      <SoundStatusChip />
      <span className="text-slate-300 dark:text-zinc-700">|</span>
      <div
        className="flex items-center gap-1.5"
        title={isConnected ? "Live order feed connected" : "Reconnecting — orders will catch up automatically"}
      >
        <span
          className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`}
        />
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
          {isConnected ? "Connected" : "Reconnecting"}
        </span>
      </div>
    </div>
  );

  return (
    <main className="h-screen bg-[#F1F5F9] dark:bg-zinc-950 lg:p-4">
      {/* ─── DESKTOP LAYOUT ─── */}
      <div className="hidden lg:flex h-full gap-4">
        <Sidebar
          isMobileOpen={false}
          onMobileClose={() => {}}
        />
        <section className="h-full flex-1 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col overflow-hidden">
          <Navbar onHamburgerClick={() => {}} />
          {statusStrip}
          <div className="flex-1 overflow-y-auto p-5">
            <Outlet context={socket} />
          </div>
        </section>
      </div>

      {/* ─── MOBILE LAYOUT ─── */}
      <div className="flex lg:hidden flex-col h-full">
        {/* Mobile Sidebar Drawer Overlay */}
        {isMobileSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        )}

        {/* Mobile Sidebar Drawer */}
        <div
          className={`fixed top-0 left-0 h-full z-50 transform transition-transform duration-300 ease-in-out ${
            isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar
            isMobileOpen={isMobileSidebarOpen}
            onMobileClose={() => setIsMobileSidebarOpen(false)}
          />
        </div>

        {/* Mobile Topbar */}
        <div className="shrink-0 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 shadow-sm">
          <Navbar onHamburgerClick={() => setIsMobileSidebarOpen(true)} />
          {statusStrip}
        </div>

        {/* Mobile Scrollable Content */}
        <div className="flex-1 overflow-y-auto bg-[#F1F5F9] dark:bg-zinc-950 pb-20">
          <div>
            <Outlet context={socket} />
          </div>
        </div>

        {/* Bottom Navigation */}
        <BottomNav />
      </div>

      {/* ─── PASSIVE AUDIO-BLOCKED BANNER (never blocks the order view) ───
          GUIDE.md Week 1: the old full-screen "Tap to Enable Sound" modal is
          gone. It defeated its own purpose — it only works if the vendor is
          already looking at the screen. This banner informs without blocking. */}
      {ringBlocked && pendingOrders.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 bg-red-600 text-white pl-4 pr-2 py-2 rounded-xl shadow-2xl max-w-[calc(100vw-2rem)]">
          <span className="text-lg">🔔</span>
          <p className="text-xs font-bold leading-tight">
            Sound blocked — orders are waiting silently.
          </p>
          <button
            onClick={handleEnableSound}
            className="shrink-0 bg-white text-red-700 text-xs font-black uppercase tracking-wider px-3 py-2 rounded-lg hover:bg-red-50 transition-colors"
          >
            Enable sound
          </button>
        </div>
      )}
    </main>
  );
};

export default Layout;
