import { Check, Copy } from 'lucide-react';
import { useState } from "react";
import toast from "react-hot-toast";
import { useOrderStore } from "../../stores/useOrderStore";
import type { OrderActionEvent } from "../../types/order";

const formatPhone = (phone: string) => {
  if (!phone) return "";

  // Remove any non-numeric characters (like +, -, spaces)
  const clean = phone.replace(/\D/g, "");

  // If it starts with 91 and has 12 digits, remove the first two digits
  if (clean.startsWith("91") && clean.length === 12) {
    return clean.slice(2);
  }

  return clean;
};

const formatAddress = (raw: string) => {

  if (!raw || !raw.startsWith("{")) return raw;

  try {
    // Remove { and } then split into key=value pairs
    const parts = raw.slice(1, -1).split(", ");
    const map: Record<string, string> = {};

    parts.forEach(part => {

      const [key, ...rest] = part.split("=");
      const val = rest.join("=");

      if (key && val) map[key.trim()] = val.trim();
    });
    // Build a readable string (Ignoring lat/lng)
    const { addressLine1, addressLine2, city, state, pincode } = map;
    const lines = [addressLine1, addressLine2, city, state].filter(Boolean);

    let result = lines.join(", ");
    if (pincode) result += ` - ${pincode}`;

    return result;
  } catch (e) {
    return raw; // Fallback to raw if parsing fails
  }
};

export const IncomingOrderCard = ({ order }: { order: OrderActionEvent }) => {
  const cleanAddress = formatAddress(order.customerAddress);
  const cleanPhone = formatPhone(order.customerMobile ? String(order.customerMobile) : "");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = async (text: string, field: string) => {
    if (!text) return;

    try {
   
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
      toast.error("Clipboard access denied");
    }
  };
  const Smartbiz_Url = "https://smartbiz.amazon.in/";
  const { markAsViewed, viewedOrderIds } = useOrderStore();
  const isViewed = viewedOrderIds.has(order.orderId);

  const handleView = () => {
    markAsViewed(order.orderId);
    window.open(`${Smartbiz_Url}orders/${order.orderId}`, "_blank");
  };

  return (
    <div className="relative bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm dark:shadow-xl hover:border-slate-300 dark:hover:border-zinc-700 transition-all">
      {/* Top Section */}
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#1e40af] dark:bg-emerald-500 animate-pulse" />
          <span className="text-slate-500 dark:text-zinc-400 font-mono text-xs">#{order.orderId}</span>
        </div>
        {isViewed && (
          <span className="px-2 py-0.5 bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-500 text-[10px] font-bold rounded uppercase">
            Viewed
          </span>
        )}
      </div>

      {/* Items Section */}
      <div className="mb-4">
        <h4 className="text-slate-900 dark:text-white font-semibold text-lg line-clamp-1">
          {order.orderItem.map(i => i.name).join(", ")}
        </h4>
        {/* Hide description if it is same as order items */}
        <p className={`text-slate-500 dark:text-zinc-500 text-sm mt-1 line-clamp-2 ${order.orderDescription === order.orderItem.map(i => i.name).join(", ")
          ? 'invisible'
          : 'visible'
          }`}>
          {order.orderDescription || " "}
        </p>
      </div>

      {/* Customer Details Section */}
      {(order.customerName || order.customerMobile || order.customerAddress) && (
        <div className="mb-4 bg-slate-50 dark:bg-zinc-950/50 rounded-lg p-3 border border-slate-100 dark:border-zinc-800/50">
          <div className="flex flex-col gap-1.5">

            {/* NAME  */}
            {order.customerName && (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-slate-400 dark:text-zinc-500 shrink-0">👤</span>
                <p
                  className="text-sm text-slate-700 dark:text-zinc-200 font-medium truncate"
                  title={order.customerName}
                >
                  {order.customerName}
                </p>
              </div>
            )}

            {/* PHONE  */}
            {order.customerMobile && (
              <div className="flex items-center justify-between group min-w-0 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-400 dark:text-zinc-500 shrink-0">📞</span>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 font-mono truncate">
                    {cleanPhone}
                  </p>
                </div>
                <button
                  onClick={() => handleCopy(cleanPhone, "Phone")}
                  className="text-slate-400 dark:text-zinc-500 hover:text-[#1e40af] dark:hover:text-emerald-400 transition-colors p-1 shrink-0"
                >
                  {copiedField === "Phone" ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            )}

            {/* ADDRESS */}
            {order.customerAddress && (
              <div className="flex items-start justify-between group gap-2 min-w-0">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <span className="text-slate-400 dark:text-zinc-500 shrink-0 mt-0.5">📍</span>
                  <p
                    className="text-xs text-slate-500 dark:text-zinc-500 line-clamp-2 break-all mt-0.5"
                    title={cleanAddress}
                  >
                    {cleanAddress}
                  </p>
                </div>
                <button
                  onClick={() => handleCopy(cleanAddress, "Address")}
                  className="text-slate-400 dark:text-zinc-500 hover:text-[#1e40af] dark:hover:text-emerald-400 transition-colors p-1 shrink-0 mt-0.5"
                >
                  {copiedField === "Address" ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Price & Quantity */}
      <div className="flex border-t border-slate-200 dark:border-zinc-800 pt-4 mb-5 gap-6">
        <div>
          <p className="text-[10px] text-slate-500 dark:text-zinc-500 uppercase font-bold">Total Amount</p>
          <p className="text-[#1e40af] dark:text-emerald-400 font-bold text-xl">₹{order.amountExcludingDeliveryFee}</p>
        </div>
        <div>
          <p className="text-[10px] text-slate-500 dark:text-zinc-500 uppercase font-bold">Quantity</p>
          <p className="text-slate-900 dark:text-white font-bold text-xl">{order.totalItemCount}</p>
        </div>
      </div>

      {/* Action Section */}
      {isViewed && (
        <p className="text-[11px] text-rose-500 font-bold text-center mb-3 animate-pulse">
          Please accept or reject in SmartBiz
        </p>
      )}

      <button
        onClick={handleView}
        className="w-full py-3 bg-[#1e40af] hover:bg-[#1e3a8a] dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white font-bold rounded-xl transition-all active:scale-[0.98] shadow-[0_0_20px_rgba(30,64,175,0.15)] dark:shadow-[0_0_20px_rgba(16,185,129,0.2)]"
      >
        View Order
      </button>
    </div>
  );
};
