import { Check, Eye, X } from "lucide-react";
import { useOrderTimer } from "../../hooks/useOrderTimer";
import { usePendingOrder } from "../../hooks/usePendingOrders";
import type { OrderActionEvent } from "../../types/order";

interface PendingOrderCardProps {
  order: OrderActionEvent;
  sequence: number;
  onViewDetails: () => void;
}

const PREP_TIMES = [5, 10, 15, 20, 25];

export const PendingOrderCard = ({ order, onViewDetails }: PendingOrderCardProps) => {
const { displayTime } = useOrderTimer(order.creationTime, "UP");

  // ─── Injecting logic from our new custom hook ───
  const {
    prepTime,
    setPrepTime,
    showRejectForm,
    setShowRejectForm,
    rejectReason,
    setRejectReason,
    reasonError,
    setReasonError,
    isAccepting,
    isRejecting,
    handleAccept,
    handleConfirmReject,
    handleCancelReject
  } = usePendingOrder(order.orderId);

  return (
    <div className="bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-900/50 rounded-xl p-4 shadow-sm relative hover:shadow-md transition-shadow">

      {/* Top Header */}
      <div className="flex items-center justify-between mb-3 border-b border-slate-100 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
         
          <span className="text-sm font-black text-slate-800 dark:text-zinc-100">#{order.orderId}</span>
          <span className="px-1.5 py-0.5 bg-amber-500 text-white text-[9px] font-black uppercase rounded">New</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onViewDetails}
            className="p-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-500 transition-colors">
            <Eye size={16} />
          </button>
          <span className="text-sm font-bold text-red-600 dark:text-red-400">{displayTime}</span>
        </div>
      </div>

      {/* Customer Info */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-200">{order.customerName}</h4>
          <p className="text-[10px] text-slate-500 dark:text-zinc-500 mt-0.5">Received {displayTime} ago</p>
        </div>
        <span className="text-base font-black text-slate-900 dark:text-white">₹{order.amountExcludingDeliveryFee}</span>
      </div>

      {/* Order Items — scrollable after 4 items, card layout never breaks */}
      <div className="bg-slate-50 dark:bg-zinc-950/50 rounded-lg p-2.5 mb-4 border border-slate-100 dark:border-zinc-800/80">
        <ul className="space-y-1.5 max-h-[116px] overflow-y-auto custom-scrollbar pr-0.5">
          {order.orderItem?.map((item, idx) => (
            <li key={idx} className="flex justify-between text-xs">
              <span className="text-slate-700 dark:text-zinc-300">
                <span className="font-bold text-slate-500 dark:text-zinc-500 mr-2">{item.itemCount}x</span>
                {item.name}
              </span>
              <span className="font-bold text-slate-600 dark:text-zinc-400 shrink-0 ml-2">
                ₹{item.itemPrice ? item.itemPrice * item.itemCount : "--"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Conditional UI Swap Area */}
      {showRejectForm ? (
        // ─── STATE B: REJECT CONFIRMATION FORM ───
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-200 bg-red-50 dark:bg-red-950/20 p-3 rounded-lg border border-red-100 dark:border-red-900/30">
          <p className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1">
            <X size={12} /> Confirm Rejection
          </p>

          <input
            type="text"
            required
            autoFocus
            placeholder="Type reason here... (Required)"
            value={rejectReason}
            onChange={(e) => {
              setRejectReason(e.target.value);

              if (e.target.value.trim().length >= 3) {
                setReasonError("");
              }
            }}

            className={`w-full text-xs px-3 py-2 mb-1 border rounded-lg bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 ${reasonError
                ? "border-red-500 focus:ring-red-500/50"
                : "border-red-200 dark:border-red-900/50 focus:ring-red-500/50"
              }`}
          />


          {reasonError && (
            <p className="text-[10px] font-bold text-red-600 dark:text-red-400 mb-3 ml-1 animate-in fade-in">
              {reasonError}
            </p>
          )}


          <div className={`flex gap-2 ${!reasonError ? "mt-3" : ""}`}>
            <button
              onClick={handleCancelReject}
              className="flex-1 flex justify-center items-center py-2 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmReject}
              disabled={isRejecting}
              className="flex-1 flex justify-center items-center gap-1.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
            >
              {isRejecting ? "Rejecting..." : "Reject"}
            </button>
          </div>
        </div>
      ) : (
        // ─── STATE A: STANDARD ACCEPT/REJECT BUTTONS ───
        <>
          {/* Preparation Time Selector */}
          <div className="mb-4">
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Select Preparation Time</p>
            <div className="flex flex-wrap gap-2">
              {PREP_TIMES.map(time => (
                <button
                  key={time}
                  onClick={() => setPrepTime(time)}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${prepTime === time
                      ? "bg-blue-600 text-white shadow-md"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    }`}
                >
                  {time} min
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleAccept}
              disabled={isAccepting}
              className="flex-1 flex justify-center items-center gap-1.5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
            >
              <Check size={16} /> {isAccepting ? "Accepting..." : "Accept Order"}
            </button>
            <button
              onClick={() => setShowRejectForm(true)}
              className="flex-1 flex justify-center items-center gap-1.5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
            >
              <X size={16} /> Reject Order
            </button>
          </div>
        </>
      )}

    </div>
  );
};