import type { ReactNode } from "react";
import { Bell } from "lucide-react";

interface OrderColumnProps {
  title: string;
  count: number;
  icon?: ReactNode;
  headerBgClass: string;
  headerTextClass: string;
  children: ReactNode;
  showBell?: boolean;
}

export const OrderColumn = ({
  title,
  count,
  icon,
  headerBgClass,
  headerTextClass,
  children,
  showBell = false,
}: OrderColumnProps) => {
  return (
    <div className="flex flex-col h-[calc(100vh-220px)] bg-slate-50/50 dark:bg-zinc-950/50 border border-slate-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
      
      {/* Column Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-zinc-800 ${headerBgClass}`}>
        <div className="flex items-center gap-2">
          {icon && <span className={headerTextClass}>{icon}</span>}
          <h3 className={`text-[13px] font-black uppercase tracking-wider ${headerTextClass}`}>
            {title} ({count})
          </h3>
        </div>
        
        {showBell && (
          <div className="relative">
            <Bell size={16} className={`${headerTextClass} animate-pulse`} />
          </div>
        )}
      </div>

      {/* Column Body / Scrollable Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
        {count === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-zinc-600 opacity-70">
            <p className="text-xs font-semibold uppercase tracking-widest text-center">No Orders Here</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
};
