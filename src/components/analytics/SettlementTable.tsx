import { AlertCircle, CheckCircle2, Clock, MinusCircle } from "lucide-react";
import type { SettlementWeek } from "../../utils/analytics/report";
import { addDays } from "../../utils/analytics/period";
import { dayLabel, inr } from "../../utils/analytics/format";

const STATUS: Record<SettlementWeek["status"], { label: string; icon: typeof Clock; tone: string }> = {
  in_progress: { label: "In progress", icon: Clock, tone: "text-[#2a78d6] dark:text-[#3987e5]" },
  settled: { label: "Settled", icon: CheckCircle2, tone: "text-[#0ca30c]" },
  pending: { label: "Awaiting settlement", icon: AlertCircle, tone: "text-[#ec835a]" },
  empty: { label: "No sales", icon: MinusCircle, tone: "text-slate-400 dark:text-zinc-500" },
};

const short = (d: Date) => dayLabel(d).slice(4); // "5 Oct"

// Week-by-week payouts (Mon–Sun, paid the next Monday). A row click opens that week.
export const SettlementTable = ({
  weeks,
  selectedStart,
  onSelect,
}: {
  weeks: SettlementWeek[];
  selectedStart: Date | null;
  onSelect: (index: number) => void;
}) => (
  <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-400">
          <th className="py-2 pr-3 font-bold">Week (Mon–Sun)</th>
          <th className="py-2 pr-3 font-bold">Payout</th>
          <th className="py-2 pr-3 text-right font-bold">Orders</th>
          <th className="hidden py-2 pr-3 text-right font-bold sm:table-cell">Gross</th>
          <th className="hidden py-2 pr-3 text-right font-bold sm:table-cell">Commission</th>
          <th className="py-2 pr-3 text-right font-bold">Net payout</th>
          <th className="py-2 font-bold">Status</th>
        </tr>
      </thead>
      <tbody>
        {weeks.map((w, i) => {
          const s = STATUS[w.status];
          const selected = selectedStart?.getTime() === w.range.start.getTime();
          return (
            <tr
              key={w.range.start.getTime()}
              onClick={() => onSelect(i)}
              className={`cursor-pointer border-t border-slate-100 dark:border-zinc-800 transition-colors ${
                selected ? "bg-[#1e40af]/5 dark:bg-blue-500/10" : "hover:bg-slate-50 dark:hover:bg-zinc-800/60"
              }`}
            >
              <td className="py-2.5 pr-3 whitespace-nowrap">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(i);
                  }}
                  aria-pressed={selected}
                  className="text-left font-semibold text-slate-900 dark:text-zinc-100 hover:underline"
                >
                  {short(w.range.start)} – {short(addDays(w.range.end, -1))}
                </button>
                {i === 0 && <span className="ml-2 text-[10px] text-slate-400 dark:text-zinc-500">This week</span>}
              </td>
              <td className="py-2.5 pr-3 whitespace-nowrap text-slate-600 dark:text-zinc-300">{dayLabel(w.payoutDate)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600 dark:text-zinc-300">{w.completed}</td>
              <td className="hidden py-2.5 pr-3 text-right tabular-nums text-slate-600 dark:text-zinc-300 sm:table-cell">
                {inr(w.gross)}
              </td>
              <td className="hidden py-2.5 pr-3 text-right tabular-nums text-slate-600 dark:text-zinc-300 sm:table-cell">
                {inr(w.commission)}
              </td>
              <td className="py-2.5 pr-3 text-right font-bold tabular-nums text-slate-900 dark:text-zinc-100">{inr(w.net)}</td>
              <td className="py-2.5 whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-zinc-200">
                  <s.icon size={13} className={s.tone} aria-hidden />
                  {w.status === "settled" || w.status === "pending" ? `${s.label} (${w.settledOrders}/${w.completed})` : s.label}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
