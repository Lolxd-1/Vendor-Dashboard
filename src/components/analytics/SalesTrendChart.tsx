import { useState } from "react";
import type { SeriesPoint } from "../../utils/analytics/report";
import { compactInr, dayLabel, inr, monthLabel, niceStep } from "../../utils/analytics/format";
import { AXIS_TEXT, GRID_LINE } from "./colors";
import { EmptyNote } from "./ui";

const xLabel = (p: SeriesPoint, i: number, grain: "day" | "month", many: boolean) => {
  if (grain === "month") return monthLabel(p.start).slice(0, 3);
  const [weekday, date, month] = dayLabel(p.start).split(" ");
  if (!many) return `${weekday} ${date}`;
  return i === 0 || p.start.getDate() === 1 ? `${date} ${month}` : date;
};

// Column chart of completed sales per day (or month), with a hover/focus tooltip per bar.
export const SalesTrendChart = ({ points, grain }: { points: SeriesPoint[]; grain: "day" | "month" }) => {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...points.map((p) => p.gross));
  if (max === 0) return <EmptyNote text="No completed sales in this period yet." />;

  const step = niceStep(max / 4);
  const top = step * Math.ceil(max / step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const every = Math.ceil(points.length / 10);
  const many = points.length > 8;
  const tip = active === null ? null : points[active];

  return (
    <div className="overflow-hidden pt-2 pr-2">
      <div className="relative ml-11 h-48 lg:h-56">
        {ticks.map((t) => (
          <div key={t} className={`absolute inset-x-0 border-t ${GRID_LINE}`} style={{ bottom: `${(t / top) * 100}%` }}>
            <span className={`absolute -left-11 w-10 -translate-y-1/2 pr-1 text-right text-[10px] tabular-nums ${AXIS_TEXT}`}>
              {compactInr(t)}
            </span>
          </div>
        ))}

        <div className="absolute inset-0 flex items-end gap-[2px]">
          {points.map((p, i) => (
            <button
              type="button"
              key={p.key}
              className="flex h-full flex-1 items-end justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2a78d6]/40 rounded"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${p.label}: ${inr(p.gross)} sales from ${p.completed} completed orders`}
            >
              <span
                className="w-full max-w-6 rounded-t bg-[#2a78d6] dark:bg-[#3987e5] transition-opacity"
                style={{
                  height: `${(p.gross / top) * 100}%`,
                  minHeight: p.gross > 0 ? 2 : 0,
                  opacity: active === null || active === i ? 1 : 0.45,
                }}
              />
            </button>
          ))}
        </div>

        {tip && active !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg bg-slate-900 dark:bg-zinc-100 px-3 py-2 text-[11px] text-white dark:text-zinc-900 shadow-lg whitespace-nowrap"
            style={{ left: `${Math.min(85, Math.max(15, ((active + 0.5) / points.length) * 100))}%` }}
          >
            <p className="font-bold">{tip.label}</p>
            <p>Sales {inr(tip.gross)} · Net {inr(tip.net)}</p>
            <p className="opacity-70">
              {tip.completed} completed of {tip.orders} orders
            </p>
          </div>
        )}
      </div>

      <div className="ml-11 mt-1.5 flex gap-[2px]">
        {points.map((p, i) => (
          <span key={p.key} className={`flex-1 text-center text-[10px] whitespace-nowrap ${AXIS_TEXT}`}>
            {i % every === 0 ? xLabel(p, i, grain, many) : ""}
          </span>
        ))}
      </div>
    </div>
  );
};
