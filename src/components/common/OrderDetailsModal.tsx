import { useRef } from "react";
import { X, Phone, User, Store, Navigation } from "lucide-react";
import type { OrderActionEvent } from "../../types/order";

interface OrderDetailsModalProps {
    order: OrderActionEvent;
    onClose: () => void;
}

// --- BULLETPROOF Address Parser (Handles BOTH new Object AND old Java Map String) ---
const parseAddress = (addr: any) => {
    if (!addr) return "—";

    if (typeof addr === 'string') {
        if (addr.startsWith("{") && addr.endsWith("}")) {
            const parts = addr.slice(1, -1).split(", ");
            const addrObj: Record<string, string> = {};
            parts.forEach(p => {
                const firstEqual = p.indexOf("=");
                if (firstEqual > -1) {
                    const k = p.substring(0, firstEqual).trim();
                    const v = p.substring(firstEqual + 1).trim();
                    addrObj[k] = v;
                }
            });
            const lines = [
                addrObj.addressLine1,
                addrObj.addressLine2,
                addrObj.addressLine3,
                addrObj.city,
                addrObj.state,
                addrObj.pincode
            ].filter(Boolean);
            return lines.length > 0 ? lines.join(", ") : addr;
        }
        return addr;
    }

    // Case 2: New Clean JSON Format (Object)
    const lines = [
        addr.addressLine1,
        addr.addressLine2,
        addr.addressLine3,
        addr.city,
        addr.state,
        addr.pincode
    ].filter(Boolean);

    return lines.length > 0 ? lines.join(", ") : "—";
};

// --- Smart Date Formatter ---
const formatDateTime = (timestamp: string | number | undefined) => {
    if (!timestamp) return "—";
    // Fix: replace space with "T" to handle "2026-07-06 14:41:20" format correctly
    const normalized = typeof timestamp === 'string' ? timestamp.replace(" ", "T") : timestamp;
    let date = new Date(normalized);

    if (isNaN(date.getTime()) && typeof timestamp === 'string' && /^\d+$/.test(timestamp)) {
        date = new Date(Number(timestamp));
    }
    if (isNaN(date.getTime())) return String(timestamp);

    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleString('default', { month: 'short' });

    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;

    return `${day} ${month}, ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
};

export const OrderDetailsModal = ({ order, onClose }: OrderDetailsModalProps) => {
    // ─── Swipe-down-to-close (mobile bottom sheet) ───
    const touchStartY = useRef<number | null>(null);

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (touchStartY.current === null) return;
        const swipedDown = e.changedTouches[0].clientY - touchStartY.current;
        if (swipedDown > 80) onClose(); // 80px threshold feels natural
        touchStartY.current = null;
    };

    // ─── FINAL Data Extraction Engine ───
    const orderId = order.orderId || "N/A";
    const status = order.state || "NEW";

    // Summary Details
    const amount = order.amountExcludingDeliveryFee || 0;
    const items = order.orderItem || [];
    const totalQty = order.orderItem?.length || items.length;

    // Timestamps
    const timestamp = order.creationTime;

    // Customer Details
    const customerName = order.customerName || "—";
    const customerPhone = order.customerMobile || "—";
    const customerAddress = parseAddress(order.customerAddress);

    // Shop & Rider Details
    const shopName = order.shopDetails?.name || "Your Store";
    const shopAddr = order.shopDetails?.address;
    const shopAddressText = shopAddr
        ? [shopAddr.address, shopAddr.city, shopAddr.state, shopAddr.postalCode].filter(Boolean).join(", ")
        : "Pickup from registered store location.";
    const rider = order.deliveryPartnerDetails;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-end lg:items-center justify-center bg-slate-900/60 backdrop-blur-sm transition-all"
            onClick={onClose}
        >
            {/* ─── MOBILE: Full bottom-sheet. DESKTOP: Centered modal ─── */}
            <div
                className="
                    relative w-full bg-[#f8fafc] dark:bg-zinc-900 shadow-2xl flex flex-col overflow-hidden
                    animate-in fade-in duration-200
                    rounded-t-3xl max-h-[92vh] slide-in-from-bottom-4
                    lg:rounded-2xl lg:max-w-2xl lg:max-h-[90vh] lg:mx-4 lg:zoom-in-95
                "
                onClick={(e) => e.stopPropagation()}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                {/* ─── Mobile drag handle ─── */}
                <div className="lg:hidden flex justify-center pt-3 pb-1 shrink-0">
                    <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-zinc-700" />
                </div>

                {/* ─── Header ─── */}
                <div className="flex items-center justify-between px-5 py-3 lg:px-6 lg:py-4 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 shrink-0">
                    <div>
                        <p className="text-[10px] font-bold text-blue-700 dark:text-blue-400 mb-0.5 tracking-wider">#{orderId}</p>
                        <h2 className="text-lg lg:text-xl font-black text-slate-900 dark:text-zinc-100 tracking-tight">Order Details</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors active:scale-95"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* ─── Scrollable Body ─── */}
                <div className="overflow-y-auto p-4 lg:p-6 space-y-4 lg:space-y-5 custom-scrollbar flex-1">

                    {/* Top Row: Status, Amount, Created */}
                    <div className="grid grid-cols-3 gap-2 lg:gap-4">
                        <div className="bg-white dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl p-2 lg:p-3.5 shadow-sm">
                            <p className="text-[9px] lg:text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500 mb-1">Status</p>
                            <span className="inline-block px-1.5 py-0.5 lg:px-2.5 lg:py-1 rounded-md text-[9px] lg:text-[11px] font-bold bg-[#1e40af]/10 text-[#1e40af] dark:text-blue-400 border border-[#1e40af]/20 uppercase tracking-wide break-all leading-tight">
                                {status}
                            </span>
                        </div>
                        <div className="bg-white dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl p-2 lg:p-3.5 shadow-sm">
                            <p className="text-[9px] lg:text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500 mb-1">Amount</p>
                            <p className="text-sm lg:text-base font-black text-slate-900 dark:text-zinc-100">₹{amount}</p>
                        </div>
                        <div className="bg-white dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl p-2 lg:p-3.5 shadow-sm">
                            <p className="text-[9px] lg:text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500 mb-1">Created</p>
                            <p className="text-[10px] lg:text-sm font-bold text-slate-700 dark:text-zinc-300 leading-snug">{formatDateTime(timestamp)}</p>
                        </div>
                    </div>

                    {/* Items List */}
                    <div className="bg-white dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl shadow-sm overflow-hidden">
                        <div className="bg-slate-50 dark:bg-zinc-800 border-b border-slate-200 dark:border-zinc-700 px-4 py-2.5 flex justify-between items-center">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100">Items</h3>
                            <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">{totalQty} item{totalQty !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="p-2 divide-y divide-slate-100 dark:divide-zinc-700/50 max-h-[180px] overflow-y-auto custom-scrollbar">
                            {items.map((item: any, idx: number) => (
                                <div key={idx} className="flex justify-between items-center p-2.5 hover:bg-slate-50 dark:hover:bg-zinc-700/30 transition-colors rounded-lg">
                                    <div className="flex flex-col min-w-0 flex-1 mr-2">
                                        <span className="text-sm font-semibold text-slate-700 dark:text-zinc-200 truncate">{item.name}</span>
                                        <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium">ID: #{item.id}</span>
                                    </div>
                                    <span className="text-xs font-black text-slate-800 dark:text-zinc-200 bg-slate-100 dark:bg-zinc-700 border border-slate-200 dark:border-zinc-600 px-2 py-1 rounded-md shrink-0">
                                        x{item.itemCount}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Addresses: Pickup & Drop */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 lg:gap-4">
                        <div className="bg-white dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl p-3.5 lg:p-4 shadow-sm">
                            <div className="flex items-center gap-2 mb-2.5">
                                <Store size={13} className="text-[#1e40af] dark:text-blue-400 shrink-0" />
                                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400">Shop · Pickup</h4>
                            </div>
                            <p className="text-sm font-black text-slate-900 dark:text-zinc-100 mb-1">{shopName}</p>
                            <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed line-clamp-3">
                                {shopAddressText}
                            </p>
                        </div>

                        <div className="bg-white dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl p-3.5 lg:p-4 shadow-sm">
                            <div className="flex items-center gap-2 mb-2.5">
                                <User size={13} className="text-[#1e40af] dark:text-blue-400 shrink-0" />
                                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400">Customer · Drop</h4>
                            </div>
                            <p className="text-sm font-black text-slate-900 dark:text-zinc-100 mb-1">{customerName}</p>
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400 flex items-center gap-1 mb-2">
                                <Phone size={10} /> {`+${customerPhone}`}
                            </p>
                            <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed line-clamp-3">
                                {customerAddress}
                            </p>
                        </div>
                    </div>

                    {/* Rider Section */}
                    {(rider || order.assignedPartner) && (
                        <div className="bg-[#0f172a] rounded-xl overflow-hidden shadow-md">
                            <div className="px-3 lg:px-4 py-2.5 lg:py-3 flex items-center justify-between border-b border-slate-700/50 gap-2">
                                <div className="flex items-center gap-1.5 lg:gap-2 min-w-0">
                                    <Navigation size={13} className="text-emerald-400 shrink-0" />
                                    <h3 className="text-[10px] lg:text-xs font-bold text-white uppercase tracking-wider truncate">Delivery Partner</h3>
                                </div>
                                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[9px] font-bold uppercase tracking-wider rounded whitespace-nowrap shrink-0">
                                    {order.assignedPartner?.orderStatus
                                        ? order.assignedPartner.orderStatus.replace(/_/g, ' ')
                                        : "Assigned"}
                                </span>
                            </div>
                            <div className="p-3 lg:p-4 flex items-center justify-between flex-wrap gap-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-slate-800 flex items-center justify-center border border-slate-600 shrink-0">
                                        <User className="text-slate-300" size={18} />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-white">{rider?.name || "Waiting for Rider"}</h4>
                                        <p className="text-[10px] text-slate-400 mt-0.5 font-mono">ID: {rider?.id?.split('-')[0] || "—"}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
                                    <Phone size={11} className="text-emerald-400" />
                                    <span className="text-xs font-semibold text-slate-200">+{rider?.mobileNumber || "—"}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Extra bottom padding for mobile safe area */}
                    <div className="h-1 lg:hidden" />
                </div>
            </div>
        </div>
    );
};