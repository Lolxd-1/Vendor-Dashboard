import { useDashboardStats } from "../../hooks/useDashboardStats";
import { ListOrdered, Clock } from "lucide-react";

export const SummaryStatsRow = () => {
  const { stats } = useDashboardStats();

  const statItems = [
    {
      label: "Today Orders",
      value: stats.total,
      icon: ListOrdered,
      iconBg: "bg-blue-50 dark:bg-blue-500/10",
      iconColor: "text-blue-600 dark:text-blue-400",
    },
    {
      label: "Avg Accept",
      value: stats.avgAcceptanceTime,
      icon: Clock,
      iconBg: "bg-purple-50 dark:bg-purple-500/10",
      iconColor: "text-purple-600 dark:text-purple-400",
    },
    {
      label: "Avg Prep",
      value: stats.avgPreparationTime,
      icon: Clock,
      iconBg: "bg-cyan-50 dark:bg-cyan-500/10",
      iconColor: "text-cyan-600 dark:text-cyan-400",
    },
  ];

  return (
    <>
      {/* ─── Mobile: single row, 3 equal cards ─── */}
      <div className="lg:hidden grid grid-cols-3 gap-2 mb-4">
        {statItems.map((item) => (
          <div
            key={item.label}
            className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-2.5 shadow-sm flex flex-col items-center justify-center text-center gap-1"
          >
            <p className="text-[8px] font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wide leading-tight">
              {item.label}
            </p>
            <p className="text-base font-black text-slate-800 dark:text-zinc-100 leading-none">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {/* ─── Desktop: 6-column grid (full original set) ─── */}
      <div className="hidden lg:grid grid-cols-6 gap-3 mb-5">
        {[
          { label: "Total Orders Today", value: stats.total, icon: ListOrdered, iconBg: "bg-blue-50 dark:bg-blue-500/10", iconColor: "text-blue-600 dark:text-blue-400" },
          { label: "Pending Orders", value: stats.pending, icon: Clock, iconBg: "bg-rose-50 dark:bg-rose-500/10", iconColor: "text-rose-600 dark:text-rose-400" },
          { label: "Accepted Orders", value: stats.accepted, icon: Clock, iconBg: "bg-amber-50 dark:bg-amber-500/10", iconColor: "text-amber-600 dark:text-amber-400" },
          { label: "Ready Orders", value: stats.ready, icon: Clock, iconBg: "bg-emerald-50 dark:bg-emerald-500/10", iconColor: "text-emerald-600 dark:text-emerald-400" },
          { label: "Avg Accept Time", value: stats.avgAcceptanceTime, icon: Clock, iconBg: "bg-purple-50 dark:bg-purple-500/10", iconColor: "text-purple-600 dark:text-purple-400" },
          { label: "Avg Prep Time", value: stats.avgPreparationTime, icon: Clock, iconBg: "bg-cyan-50 dark:bg-cyan-500/10", iconColor: "text-cyan-600 dark:text-cyan-400" },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-3 shadow-sm flex flex-col justify-center"
          >
            <div className="flex items-center gap-2 mb-1">
              <div className={`p-1.5 rounded-lg ${item.iconBg}`}>
                <item.icon size={14} className={item.iconColor} />
              </div>
              <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wide">
                {item.label}
              </p>
            </div>
            <p className="text-xl font-black text-slate-800 dark:text-zinc-100 pl-1">{item.value}</p>
          </div>
        ))}
      </div>
    </>
  );
};
