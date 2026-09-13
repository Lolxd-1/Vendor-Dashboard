import { Eye, Check, AlertCircle } from "lucide-react";
import type { OrderActionEvent } from "../../types/order";
import { useOrderTimer } from "../../hooks/useOrderTimer";
import { useDashboardStore } from "../../stores/useDashboardStore";
import { useMarkOrderReadyMutation } from "../../apis/dashboardApi";
import toast from "react-hot-toast";

interface AcceptedOrderCardProps {
  order: OrderActionEvent;
  sequence: number;
  onViewDetails: () => void;
}

export const AcceptedOrderCard = ({ order, onViewDetails }: AcceptedOrderCardProps) => {
  const prepTime = order.preparationTime || 15;


  const { displayTime } = useOrderTimer(order.acceptedDate || order.creationTime, "DOWN", order.preparationTime);

  const { moveToReady } = useDashboardStore();
  const [markReady, { isLoading }] = useMarkOrderReadyMutation();

  // ─── Inline Action Handler (No extra hook needed) ───
  const handleMarkReady = async () => {
    try {
      await markReady({ orderId: order.orderId }).unwrap();
      moveToReady(order.orderId);
      toast.success(`Order ${order.orderId} marked ready`);
    } catch (error) {
      toast.error(`Failed to mark ready for ${order.orderId}`);
    }
  };

  // ─── Warning Logic: Trigger if time is 01:00 or starts with 00: (e.g. 00:59 to 00:00) ───
  const isTimeCritical = displayTime === "01:00" || displayTime.startsWith("00:");
  const isTimeUp = displayTime === "00:00";

  return (
    <div className={`bg-white dark:bg-zinc-900 border rounded-xl p-4 shadow-sm relative hover:shadow-md transition-shadow ${isTimeUp ? "border-red-500 dark:border-red-500/50" : "border-amber-200 dark:border-amber-900/50"
      }`}>

      {/* Top Header — single row */}
      <div className="mb-3 border-b border-slate-100 dark:border-zinc-800 pb-3">
        {/* Single row: seq · orderId (truncate) · prep badge · eye */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-black text-slate-800 dark:text-zinc-100 truncate flex-1">#{order.orderId}</span>
          <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold rounded-md border border-amber-200 dark:border-amber-700/50">
            ⏱ prep :{prepTime}min
          </span>
          <button
            onClick={onViewDetails}
            className="p-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-500 transition-colors shrink-0">
            <Eye size={16} />
          </button>
        </div>
      </div>

      {/* Customer Info */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-200">{order.customerName}</h4>
          <p className="text-[10px] text-slate-500 dark:text-zinc-500 mt-0.5">📞 +{order.customerMobile}</p>
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
            </li>
          ))}
        </ul>
      </div>

      {/* Rider Info */}
      {(order.deliveryPartnerDetails || order.assignedPartner) && (
        <div className="bg-slate-50 dark:bg-zinc-950/50 rounded-lg p-3 mb-4 border border-slate-200 dark:border-zinc-800/80">
          {/* Header row: label + status badge on same line */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-500 uppercase flex items-center gap-1 shrink-0">
               Rider Details
            </span>
            {order.assignedPartner?.orderStatus && (
              <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 text-[9px] font-bold uppercase whitespace-nowrap rounded-md">
                {order.assignedPartner.orderStatus.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          {/* Rider name — fixed-width emoji so text aligns on every row */}
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 w-[18px] text-center leading-tight mt-px">🙎🏻</span>
            <span
              className="text-xs font-semibold text-slate-800 dark:text-zinc-200 truncate"
              title={order.deliveryPartnerDetails?.name || "Waiting for Rider"}
            >
              {order.deliveryPartnerDetails?.name || "Waiting for Rider"}
            </span>
          </div>
          {/* Phone — same fixed-width emoji so it lines up with name above */}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="shrink-0 w-[18px] text-center text-xs">📞</span>
            <span className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
              {order.deliveryPartnerDetails?.mobileNumber || "--"}
            </span>
          </div>
        </div>
      )}

      {/* Timer & Progress */}
      <div className="flex flex-col items-center justify-center py-2 mb-4">
        <span className="text-[10px] font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-widest">Remaining Time</span>

        <span className={`text-2xl font-black tabular-nums transition-colors ${isTimeUp ? 'text-red-600 dark:text-red-500 animate-pulse' :
          isTimeCritical ? 'text-red-500' : 'text-amber-500'
          }`}>
          {displayTime}
        </span>

        {/* ─── CRITICAL WARNING MESSAGE ─── */}
        {isTimeCritical && (
          <div className="flex items-center gap-1.5 mt-1.5 animate-in fade-in zoom-in duration-300">
            <AlertCircle size={12} className="text-red-500" />
            <span className="text-[10px] font-bold text-red-600 dark:text-red-500 uppercase tracking-wide">
              {isTimeUp ? "Time is up! Mark Ready Now" : "Please Mark Ready For Pickup"}
            </span>
          </div>
        )}
      </div>

      {/* Action Button */}
      <button
        onClick={handleMarkReady}
        disabled={isLoading}
        className="w-full flex justify-center items-center gap-1.5 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
      >
        <Check size={16} /> {isLoading ? "Updating..." : "Mark Ready for Pickup"}
      </button>

    </div>
  );
};