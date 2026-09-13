import { useAuthStore } from "../stores/useAuthStore";
import { useShopOnlineStatus } from "../hooks/useShopOnlineStatus";
import { Store, Circle, Clock } from "lucide-react";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useEffect, useState } from "react";

interface NavbarProps {
  onHamburgerClick: () => void;
}

const Navbar = ({ onHamburgerClick }: NavbarProps) => {
  const shopId = useAuthStore((state) => state.shopId);
  const { stats } = useDashboardStats();

  const vendorName = sessionStorage.getItem("vendorName") || `Store #${shopId || "1"}`;

  const isShopOnline = useShopOnlineStatus(shopId);

  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  // Reusable status badge
  const StatusBadge = ({ size = "sm" }: { size?: "sm" | "xs" }) => {
    const textSize = size === "xs" ? "text-[9px]" : "text-[10px]";
    const dotSize = size === "xs" ? 6 : 8;
    return isShopOnline ? (
      <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20 shrink-0`}>
        <Circle className="fill-emerald-500 text-emerald-500 animate-pulse" size={dotSize} />
        <span className={`${textSize} font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-wider`}>
          Online
        </span>
      </div>
    ) : (
      <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/20 shrink-0`}>
        <Circle className="fill-red-500 text-red-500" size={dotSize} />
        <span className={`${textSize} font-black text-red-700 dark:text-red-400 uppercase tracking-wider`}>
          Offline
        </span>
      </div>
    );
  };

  return (
    <header className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-t-xl lg:px-6 lg:h-[72px] px-3 py-2.5">

      {/* ────────────────────────────────────────────────
          MOBILE LAYOUT
      ──────────────────────────────────────────────── */}
      <div className="flex lg:hidden items-center w-full gap-2.5">

        {/* Hamburger */}
        <button
          onClick={onHamburgerClick}
          className="p-2 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 active:scale-95 transition-all duration-200 shrink-0"
          aria-label="Open menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {/* Shop Info — center, flexible */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Store size={13} className="text-slate-400 dark:text-zinc-500 shrink-0" />
            <p className="text-sm font-black text-slate-800 dark:text-zinc-100 truncate leading-tight">
              {vendorName}
            </p>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-zinc-600 font-mono mt-0.5 pl-[18px]">
            #{shopId}
          </p>
        </div>

        {/* Right: Online/Offline status badge */}
        <StatusBadge size="xs" />
      </div>

      {/* ────────────────────────────────────────────────
          DESKTOP LAYOUT
      ──────────────────────────────────────────────── */}
      <div className="hidden lg:flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Store className="text-slate-500 dark:text-zinc-400" size={20} />
          <h2 className="text-base font-bold text-slate-800 dark:text-zinc-100">
            {vendorName}
          </h2>
          <span className="text-xs text-slate-400 dark:text-zinc-500">#{shopId}</span>
        </div>
        <StatusBadge size="sm" />
      </div>

      {/* Desktop Right: Time + Stats */}
      <div className="hidden lg:flex items-center gap-6">
        <div className="flex items-center gap-2 pr-6 border-r border-slate-200 dark:border-zinc-800">
          <Clock className="text-slate-400 dark:text-zinc-500" size={18} />
          <div className="flex flex-col">
            <span className="text-xs font-bold text-slate-800 dark:text-zinc-200">{formatTime(time)}</span>
            <span className="text-[10px] font-medium text-slate-500 dark:text-zinc-500">{formatDate(time)}</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Orders Today</span>
            <span className="text-sm font-bold text-slate-900 dark:text-white">{stats.total}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Revenue Today</span>
            <span className="text-sm font-bold text-[#1e40af] dark:text-emerald-400">{stats.revenue}</span>
          </div>
        </div>
      </div>

    </header>
  );
};

export default Navbar;