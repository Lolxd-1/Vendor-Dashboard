import { CheckCircle, FileClock, PlayCircle, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../stores/useAuthStore";
import { useGetVendorOrdersQuery } from "../apis/orderApi";
import { AcceptedOrderCard } from "../components/dashboard/AcceptedOrderCard";
import { OrderColumn } from "../components/dashboard/OrderColumn";
import { PendingOrderCard } from "../components/dashboard/PendingOrderCard";
import { ReadyOrderCard } from "../components/dashboard/ReadyOrderCard";
import { SummaryStatsRow } from "../components/dashboard/SummaryStatsRow";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useDashboardStore } from "../stores/useDashboardStore";
import type { OrderActionEvent } from "../types/order";
import { OrderDetailsModal } from "../components/common/OrderDetailsModal";

type TabKey = "pending" | "accepted" | "ready";

const Dashboard = () => {
  const { shopId } = useAuthStore();
  const { pendingOrders, acceptedOrders, readyOrders, setInitialOrders } = useDashboardStore();

  const { isFetching, refresh } = useDashboardStats();

  const { data: allOrders } = useGetVendorOrdersQuery(
    { shopId: shopId ?? "" },
    {
      skip: !shopId,
      pollingInterval: 45000,          // ← Auto-refresh every 45 seconds
      refetchOnMountOrArgChange: true, // ← Re-fetch on page revisit
    }
  );

  const [viewOrder, setViewOrder] = useState<OrderActionEvent | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const prevPendingCount = useRef(pendingOrders.length);

  // Populate Kanban columns on initial load
  useEffect(() => {
    if (allOrders) {
      setInitialOrders(allOrders);
      if (!sessionStorage.getItem("vendorName")) {
        const orderWithShop = allOrders.find((o) => o.shopDetails?.name);
        if (orderWithShop?.shopDetails?.name) {
          sessionStorage.setItem("vendorName", orderWithShop.shopDetails.name);
        }
      }
    }
  }, [allOrders, setInitialOrders]);

  // Auto-switch to Pending tab when new pending orders arrive
  useEffect(() => {
    if (pendingOrders.length > prevPendingCount.current) {
      setActiveTab("pending");
    }
    prevPendingCount.current = pendingOrders.length;
  }, [pendingOrders.length]);

  const tabs: { key: TabKey; label: string; count: number; color: string; activeBg: string; activeBorder: string; activeText: string; icon: React.ReactNode; hasBell: boolean }[] = [
    {
      key: "pending",
      label: "Pending",
      count: pendingOrders.length,
      color: "text-red-600 dark:text-red-400",
      activeBg: "bg-red-600 dark:bg-red-500",
      activeBorder: "border-red-500",
      activeText: "text-white",
      icon: <FileClock size={15} />,
      hasBell: pendingOrders.length > 0,
    },
    {
      key: "accepted",
      label: "Accepted",
      count: acceptedOrders.length,
      color: "text-amber-600 dark:text-amber-400",
      activeBg: "bg-amber-500 dark:bg-amber-500",
      activeBorder: "border-amber-500",
      activeText: "text-white",
      icon: <PlayCircle size={15} />,
      hasBell: false,
    },
    {
      key: "ready",
      label: "Ready",
      count: readyOrders.length,
      color: "text-green-600 dark:text-green-400",
      activeBg: "bg-green-600 dark:bg-green-500",
      activeBorder: "border-green-500",
      activeText: "text-white",
      icon: <CheckCircle size={15} />,
      hasBell: false,
    },
  ];

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-700 p-3">

      {/* ─── Page Header ─── */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-black text-slate-800 dark:text-zinc-100 tracking-tight">
          Live Workspace
        </h1>
        <button
          onClick={refresh}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold tracking-wider text-slate-600 dark:text-zinc-400 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg shadow-mdhover:bg-slate-50 dark:hover:bg-zinc-800 transition-all active:scale-95 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={isFetching ? "animate-spin text-blue-500" : ""} />
          {isFetching ? "Syncing..." : "Refresh"}
        </button>
      </div>

      {/* 1. Summary Stats Row */}
      <SummaryStatsRow />

      {/* ─── DESKTOP: 3-column Kanban (lg+) ─── */}
      <div className="hidden lg:grid grid-cols-3 gap-4 flex-1 min-h-0">

        <OrderColumn
          title="Pending Orders"
          count={pendingOrders.length}
          icon={<FileClock size={16} />}
          headerBgClass="bg-red-50 dark:bg-red-950/30 border-t-2 border-t-red-500"
          headerTextClass="text-red-700 dark:text-red-400"
          showBell={pendingOrders.length > 0}
        >
          {pendingOrders.map((order, idx) => (
            <PendingOrderCard
              key={order.orderId}
              order={order}
              sequence={idx + 1}
              onViewDetails={() => setViewOrder(order)}
            />
          ))}
        </OrderColumn>

        <OrderColumn
          title="Accepted Orders"
          count={acceptedOrders.length}
          icon={<PlayCircle size={16} />}
          headerBgClass="bg-amber-50 dark:bg-amber-950/30 border-t-2 border-t-amber-500"
          headerTextClass="text-amber-700 dark:text-amber-400"
        >
          {acceptedOrders.map((order, idx) => (
            <AcceptedOrderCard
              key={order.orderId}
              order={order}
              sequence={idx + 1}
              onViewDetails={() => setViewOrder(order)}
            />
          ))}
        </OrderColumn>

        <OrderColumn
          title="Ready For Pickup"
          count={readyOrders.length}
          icon={<CheckCircle size={16} />}
          headerBgClass="bg-green-50 dark:bg-green-950/30 border-t-2 border-t-green-500"
          headerTextClass="text-green-700 dark:text-green-400"
        >
          {readyOrders.map((order, idx) => (
            <ReadyOrderCard
              key={order.orderId}
              order={order}
              sequence={idx + 1}
              onViewDetails={() => setViewOrder(order)}
            />
          ))}
        </OrderColumn>
      </div>

      {/* ─── MOBILE: Tab switcher + single column (< lg) ─── */}
      <div className="lg:hidden flex flex-col flex-1 min-h-0">

        {/* Tab Buttons Row */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex flex-col items-center justify-center gap-1 py-2.5 px-2 rounded-xl border transition-all duration-200 active:scale-95 ${
                  isActive
                    ? `${tab.activeBg} ${tab.activeBorder} ${tab.activeText} shadow-md`
                    : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 shadow-sm"
                }`}
              >
                {/* Bell badge for pending */}
                {tab.hasBell && !isActive && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse border-2 border-white dark:border-zinc-950" />
                )}

                <span className={`text-[11px] font-bold tracking-wide ${isActive ? "text-white" : ""}`}>
                  {tab.label}
                </span>
                <span
                  className={`text-base font-black leading-none ${
                    isActive ? "text-white/90" : tab.color
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Active Tab Content */}
        <div className="flex-1 overflow-y-auto space-y-3 pb-2">
          {activeTab === "pending" && (
            <>
              {pendingOrders.length === 0 ? (
                <MobileEmptyState message="No pending orders" />
              ) : (
                pendingOrders.map((order, idx) => (
                  <PendingOrderCard
                    key={order.orderId}
                    order={order}
                    sequence={idx + 1}
                    onViewDetails={() => setViewOrder(order)}
                  />
                ))
              )}
            </>
          )}
          {activeTab === "accepted" && (
            <>
              {acceptedOrders.length === 0 ? (
                <MobileEmptyState message="No accepted orders" />
              ) : (
                acceptedOrders.map((order, idx) => (
                  <AcceptedOrderCard
                    key={order.orderId}
                    order={order}
                    sequence={idx + 1}
                    onViewDetails={() => setViewOrder(order)}
                  />
                ))
              )}
            </>
          )}
          {activeTab === "ready" && (
            <>
              {readyOrders.length === 0 ? (
                <MobileEmptyState message="No ready orders" />
              ) : (
                readyOrders.map((order, idx) => (
                  <ReadyOrderCard
                    key={order.orderId}
                    order={order}
                    sequence={idx + 1}
                    onViewDetails={() => setViewOrder(order)}
                  />
                ))
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── Modal ─── */}
      {viewOrder && (
        <OrderDetailsModal
          order={viewOrder}
          onClose={() => setViewOrder(null)}
        />
      )}
    </div>
  );
};

const MobileEmptyState = ({ message }: { message: string }) => (
  <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-zinc-600">
    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
      <CheckCircle size={22} className="opacity-40" />
    </div>
    <p className="text-xs font-bold uppercase tracking-widest opacity-70">{message}</p>
  </div>
);

export default Dashboard;