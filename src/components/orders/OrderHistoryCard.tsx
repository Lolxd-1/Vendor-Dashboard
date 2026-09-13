import { useState } from "react";
import { ChevronRight, User } from "lucide-react";
import type { OrderApiResponse } from "../../types/order";

// ─── Status style map (shared with table) ───────────────────────
const STATUS_STYLES: Record<string, { pill: string; dot: string }> = {
  PENDING:   { pill: "bg-amber-50  text-amber-600  border-amber-200  dark:bg-amber-500/10  dark:text-amber-400  dark:border-amber-500/20",  dot: "bg-amber-500"  },
  ACCEPTED:  { pill: "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20", dot: "bg-emerald-500" },
  REJECTED:  { pill: "bg-rose-50   text-rose-600   border-rose-200   dark:bg-rose-500/10   dark:text-rose-400   dark:border-rose-500/20",   dot: "bg-rose-500"   },
  COMPLETED: { pill: "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20", dot: "bg-emerald-500" },
  CANCELLED: { pill: "bg-rose-50   text-rose-600   border-rose-200   dark:bg-rose-500/10   dark:text-rose-400   dark:border-rose-500/20",   dot: "bg-rose-500"   },
  READY_FOR_PICKUP: { pill: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20", dot: "bg-blue-500" },
  IN_TRANSIT: { pill: "bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20", dot: "bg-purple-500" },
};

const DEFAULT_PILL = "bg-slate-100 text-slate-500 border-slate-200 dark:bg-zinc-700/40 dark:text-zinc-400 dark:border-zinc-600";

// ─── Helper: format date ─────────────────────────────────────────
const formatDate = (dateString: string): string => {
  try {
    const date = new Date(dateString.replace(" ", "T"));
    const day   = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year  = date.getFullYear();
    let hours   = date.getHours();
    const mins  = String(date.getMinutes()).padStart(2, "0");
    const ampm  = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${day}-${month}-${year}, ${String(hours).padStart(2, "0")}:${mins} ${ampm}`;
  } catch {
    return dateString;
  }
};

// ─── Props ───────────────────────────────────────────────────────
interface OrderHistoryCardProps {
  order: OrderApiResponse;
  onViewDetails: (order: OrderApiResponse) => void;
}

// ─── Single Order Card ───────────────────────────────────────────
const OrderHistoryCard = ({ order, onViewDetails }: OrderHistoryCardProps) => {
  const [nameExpanded, setNameExpanded] = useState(false);

  const statusStyle = STATUS_STYLES[order.state] ?? { pill: DEFAULT_PILL, dot: "bg-slate-400" };
  const riderName   = order.deliveryPartnerDetails?.name;
  const isCancelled = order.state === "CANCELLED" || order.state === "REJECTED";

  return (
    <div className="relative bg-gradient-to-b from-white to-slate-50/50 dark:from-[#18181b] dark:to-[#131316] rounded-2xl border border-slate-200 dark:border-zinc-800/80 border-[3px] border-b-slate-200 dark:border-b-zinc-800 shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)] p-4 sm:p-5 active:scale-[0.99] transition-transform duration-150 overflow-hidden">
      
      {/* ── Optional: Subtle inner glow for extra 3D effect ── */}
      <div className="absolute inset-0 rounded-2xl border border-white/60 dark:border-white/[0.02] pointer-events-none" />

      {/* ── Row 1: Order ID (left) + Status badge (right) ─── */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-xs font-bold text-[#1e40af] dark:text-blue-400 font-mono leading-tight truncate flex-1">
          #{order.orderId}
        </p>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${statusStyle.pill}`}>
          {order.state.replace(/_/g, " ")}
        </span>
      </div>

      {/* ── Row 2: Created date ─────────────────────────────── */}
      <p className="text-[10px] text-slate-400 dark:text-zinc-500 mb-3">
        {formatDate(order.creationTime)}
      </p>

      {/* ── Divider ─────────────────────────────────────────── */}
      <div className="border-t border-slate-100 dark:border-zinc-800 mb-3" />

      {/* ── Row 3: Customer avatar + name (expandable) + items count + amount ── */}
      <div className="flex items-center gap-2">
        {/* Avatar circle */}
        <div className="shrink-0 w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center">
          <User size={14} className="text-slate-500 dark:text-zinc-400" />
        </div>

        {/* Name + items — flexible, truncates, tap to expand */}
        <div className="flex-1 min-w-0">
          <button
            onClick={() => setNameExpanded((p) => !p)}
            className="text-left w-full"
          >
            <p
              className={`text-xs font-semibold text-slate-800 dark:text-zinc-200 ${nameExpanded ? "" : "truncate"}`}
            >
              {order.customerName || "—"}
            </p>
          </button>
          <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">
            {order.totalItemCount ?? order.orderItem?.length ?? 0} item{(order.totalItemCount ?? 1) !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Amount */}
        <span className={`shrink-0 text-sm font-black ${isCancelled ? "text-rose-500 line-through" : "text-slate-900 dark:text-white"}`}>
          ₹{order.amountExcludingDeliveryFee}
        </span>
      </div>

      {/* ── Rider row (only if rider assigned) ──────────────── */}
      {riderName && (
        <div className="mt-2.5 flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 dark:bg-zinc-800/60 rounded-lg border border-slate-100 dark:border-zinc-800">
          <span className="text-xs">🛵</span>
          <span className="text-[11px] font-semibold text-slate-600 dark:text-zinc-300 truncate">
            {riderName}
          </span>
        </div>
      )}

      {/* ── View Details button ──────────────────────────────── */}
      <div className="flex justify-end mt-3">
        <button
          onClick={() => onViewDetails(order)}
          className="flex items-center gap-1 text-[11px] font-bold text-[#1e40af] dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors active:scale-95"
        >
          View Details
          <ChevronRight size={13} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
};

export default OrderHistoryCard;
