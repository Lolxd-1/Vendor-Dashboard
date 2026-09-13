import { useState, useMemo } from "react";
import { useAuthStore } from "../stores/useAuthStore";
import { useGetVendorOrdersQuery } from "../apis/orderApi";
import FilterBar from "../components/orders/FilterBar";
import OrderTable from "../components/orders/OrderTable";
import { RefreshCw, AlertCircle } from "lucide-react";
import { OrderDetailsModal } from "../components/common/OrderDetailsModal";
import type { OrderApiResponse } from "../types/order";
import { OrderStatusFilter, TimeFilterOption } from "../types/filters";



const PAGE_SIZE = 100;

const OrderHistory = () => {
  // ─── Auth ─────────────────────────────────────────────────────
  const shopId = useAuthStore((s) => s.shopId);

  // ─── Filter state ────────────────────────────────────────────
  const [orderStatus, setOrderStatus] = useState<OrderStatusFilter[]>([]);
  const [timeRange, setTimeRange] = useState<TimeFilterOption | undefined>(undefined);
  const [customStartDate, setCustomStartDate] = useState<Date | null>(null);
  const [customEndDate, setCustomEndDate] = useState<Date | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderApiResponse | null>(null);

  // ─── Helper: Format Date for Backend (YYYY-MM-DDTHH:mm:ss) ──────
  const formatForBackend = (date: Date | null) => {
    if (!date) return undefined;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };

  // ─── RTK Query: fetch filtered orders ────────────────────────
  const { data: orders = [], isLoading, isError, refetch, isFetching } =
    useGetVendorOrdersQuery(
      {
        shopId: shopId ?? "",
        orderStatus: orderStatus.length > 0 ? orderStatus : undefined,
        timeRange: timeRange,
        fromTime: formatForBackend(customStartDate),
        toTime: formatForBackend(customEndDate),
      },
      { skip: !shopId }
    );

  // ─── Pagination state ────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);

  // ─── Handler: status change ──────────────────────────────────
 const handleStatusChange = (status: string) => {
  // If user clicks "ALL" OR clicks a status that is ALREADY selected
  const isAlreadySelected = orderStatus.includes(status as OrderStatusFilter);
  
  if (status === "ALL" || isAlreadySelected) {
    setOrderStatus([]); // Reset to All
  } else {
    setOrderStatus([status as OrderStatusFilter]); // Select new
  }
  setCurrentPage(1);
};

  // ─── Handler: time change ────────────────────────────────────
const handleTimeChange = (time: string) => {
  // If user clicks a time that is ALREADY selected, we set it to undefined
  if (time === timeRange) {
    setTimeRange(undefined); 
  } else {
    setTimeRange(time as TimeFilterOption);
  }
  
  setCustomStartDate(null);
  setCustomEndDate(null);
  setCurrentPage(1);
};

  // ─── Handler: custom date range ──────────────────────────────
  const handleCustomDateChange = (start: Date | null, end: Date | null) => {
    setCustomStartDate(start);
    setCustomEndDate(end);
    if (start && end) {
      setTimeRange(TimeFilterOption.CUSTOM);
    }
    setCurrentPage(1);
  };

  // ─── Compute: paginated orders ───────────────────────────────
  const paginatedOrders = useMemo(() => {
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    return orders.slice(startIdx, startIdx + PAGE_SIZE);
  }, [orders, currentPage]);

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-white dark:bg-zinc-900 lg:rounded-lg lg:border lg:border-slate-200 lg:dark:border-zinc-800 lg:p-5">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 lg:px-0 lg:pt-0 lg:pb-0 lg:mb-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 lg:text-xl lg:font-semibold">Order History</h2>
          <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
            {orders.length} order{orders.length !== 1 ? "s" : ""} found
          </p>
        </div>
        {/* Premium refresh button */}
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 text-xs font-semibold hover:bg-[#1e40af]/10 hover:border-[#1e40af]/30 hover:text-[#1e40af] dark:hover:bg-blue-500/10 dark:hover:text-blue-400 transition-all duration-200 disabled:opacity-50 active:scale-95"
        >
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          {isFetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Filters */}
      <div className="mb-3 lg:mb-5">
        <FilterBar
          statusFilter={orderStatus.length > 0 ? orderStatus[0] : "ALL"}
          timeFilter={timeRange || "ALL"}
          customStartDate={customStartDate}
          customEndDate={customEndDate}
          onStatusChange={handleStatusChange}
          onTimeChange={handleTimeChange}
          onCustomDateChange={handleCustomDateChange}
        />
      </div>
     

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-slate-400 dark:text-zinc-400">
            <RefreshCw size={20} className="animate-spin" />
            <span className="text-sm">Loading orders...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-20 text-rose-400">
          <AlertCircle size={32} className="mb-2" />
          <p className="text-sm font-medium">Failed to load orders</p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-4 py-1.5 rounded-lg border border-rose-500/30 text-xs hover:bg-rose-500/10 transition"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && (
        <OrderTable
          orders={paginatedOrders}
          currentPage={currentPage}
          pageSize={PAGE_SIZE}
          totalOrders={orders.length}
          onPageChange={setCurrentPage}
          onOrderClick={setSelectedOrder}
        />
      )}
      {selectedOrder && (
        <OrderDetailsModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}

    </div>
  );
};

export default OrderHistory;
