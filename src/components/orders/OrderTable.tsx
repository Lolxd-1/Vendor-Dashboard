import { ChevronLeft, ChevronRight } from "lucide-react";
import type { OrderApiResponse } from "../../types/order";
import OrderHistoryCard from "./OrderHistoryCard";

// ─── Status badge color map ─────────────────────────────────────
const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  ACCEPTED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  REJECTED: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  COMPLETED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  CANCELLED: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
};

// ─── Props ──────────────────────────────────────────────────────
interface OrderTableProps {
  orders: OrderApiResponse[];
  currentPage: number;
  pageSize: number;
  totalOrders: number;
  onPageChange: (page: number) => void;
  onOrderClick: (order: OrderApiResponse) => void;
}

// ─── Helper: format timestamp ───────────────────────────────────
const formatDate = (dateString: string): string => {
  try {
    // Fix: replace space with "T" to handle "2026-07-06 14:41:20" format correctly
    const normalized = dateString.replace(" ", "T");
    const date = new Date(normalized);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const strTime = pad(hours) + ':' + minutes + ' ' + ampm;

    return `${day}-${month}-${year}, ${strTime}`;
  } catch (e) {
    return dateString;
  }
};

const pad = (n: number) => String(n).padStart(2, '0');

// ─── Component ──────────────────────────────────────────────────
const OrderTable = ({
  orders,
  currentPage,
  pageSize,
  totalOrders,
  onPageChange,
  onOrderClick,
}: OrderTableProps) => {
  const totalPages = Math.ceil(totalOrders / pageSize);

  // ─── Empty state ──────────────────────────────────────────────
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-zinc-500">
        <p className="text-lg font-semibold text-slate-500 dark:text-zinc-400">No orders found😐</p>
        <p className="text-sm mt-1">Try adjusting your filters or wait!</p>
      </div>
    );
  }

  // ─── Badge renderer ───────────────────────────────────────────
  const renderBadge = (value: string, styleMap: Record<string, string>) => {
    const style = styleMap[value] || "bg-slate-100 dark:bg-zinc-700/40 text-slate-500 dark:text-zinc-400 border-slate-300 dark:border-zinc-600";
    return (
      <span
        className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${style}`}
      >
        {value}
      </span>
    );
  };

  return (
    <div>

      {/* ─── MOBILE: Card list (< lg) ───────────────────────────── */}
      <div className="lg:hidden space-y-3 px-4 pb-4">
        {orders.map((order) => (
          <OrderHistoryCard
            key={order.orderId}
            order={order}
            onViewDetails={onOrderClick}
          />
        ))}
      </div>

      {/* ─── DESKTOP: Table (≥ lg) ──────────────────────────────── */}
      <div className="hidden lg:block">
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-zinc-800">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/50">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Order ID</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Timestamp</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Customer Name</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Items</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Amount</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order, idx) => (
                <tr
                  key={order.orderId}
                  onClick={() => onOrderClick(order)}
                  className={`border-b border-slate-100 dark:border-zinc-800/60 transition-colors hover:bg-blue-50/50 dark:hover:bg-zinc-800/30 cursor-pointer ${
                    idx % 2 === 0 ? "bg-white dark:bg-zinc-900/50" : "bg-slate-50/50 dark:bg-zinc-900/20"
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-zinc-300">{order.orderId}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-zinc-400 whitespace-nowrap">{formatDate(order.creationTime)}</td>
                  <td className="px-4 py-3 text-xs text-slate-700 dark:text-zinc-300 max-w-[180px] truncate" title={order.customerName || "—"}>{order.customerName || "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-zinc-300">{order.totalItemCount} Items</td>
                  <td className="px-4 py-3">{renderBadge(order.state, STATUS_STYLES)}</td>
                  <td className="text-center px-4 py-3 text-xs font-semibold text-[#1e40af] dark:text-emerald-400">₹{order.amountExcludingDeliveryFee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Pagination (shared) ─────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-4 lg:px-1">
          <p className="text-xs text-slate-500 dark:text-zinc-500">
            Showing {(currentPage - 1) * pageSize + 1}–
            {Math.min(currentPage * pageSize, totalOrders)} of {totalOrders} orders
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-1.5 rounded-md border border-slate-200 dark:border-zinc-700 text-slate-400 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-slate-500 dark:text-zinc-400 min-w-[80px] text-center">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-md border border-slate-200 dark:border-zinc-700 text-slate-400 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderTable;
