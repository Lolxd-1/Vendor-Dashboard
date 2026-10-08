import { useState } from "react";
import { WEEKDAY_NAMES, hourLabel } from "../../utils/analytics/format";
import { peakCell } from "../../utils/analytics/report";
import { AXIS_TEXT, SEQ_SCOPE, seqFill } from "./colors";
import { EmptyNote } from "./ui";

const DAYS = WEEKDAY_NAMES.map((d) => d.slice(0, 3));
// Five steps, light → dark. More than ~7 colour classes stop being readable.
const LEVELS = [0.16, 0.32, 0.5, 0.72, 1];

const levelOf = (n: number, max: number) => Math.min(LEVELS.length - 1, Math.ceil((n / max) * LEVELS.length) - 1);
const orders = (n: number) => `${n} order${n === 1 ? "" : "s"}`;

// Weekday × hour grid of every order placed: when customers actually order.
export const PeakHeatmap = ({ cells, max }: { cells: number[][]; max: number }) => {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  if (max === 0) return <EmptyNote text="No orders in this period." />;

  const peak = peakCell({ cells, max });
  const summary = `Busiest: ${WEEKDAY_NAMES[peak.day]} ${hourLabel(peak.hour)} with ${orders(max)}`;

  return (
    <div className={SEQ_SCOPE}>
      <p className="mb-2 h-4 text-xs text-slate-600 dark:text-zinc-300">
        {hover
          ? `${WEEKDAY_NAMES[hover.d]} ${hourLabel(hover.h)}–${hourLabel((hover.h + 1) % 24)}: ${orders(cells[hover.d][hover.h])}`
          : summary}
      </p>
      <div className="overflow-x-auto">
        <div role="img" aria-label={summary} className="min-w-[440px]" onMouseLeave={() => setHover(null)}>
          {cells.map((row, d) => (
            <div key={DAYS[d]} className="mb-[2px] flex items-center gap-[2px]">
              <span className={`w-8 shrink-0 text-[10px] ${AXIS_TEXT}`}>{DAYS[d]}</span>
              {row.map((n, h) => (
                <div
                  key={h}
                  onMouseEnter={() => setHover({ d, h })}
                  className="h-5 flex-1 rounded-[3px] bg-slate-100 dark:bg-zinc-800"
                  style={n > 0 ? seqFill(LEVELS[levelOf(n, max)]) : undefined}
                />
              ))}
            </div>
          ))}
          <div className="ml-[34px] mt-1 flex">
            {[0, 6, 12, 18].map((h) => (
              <span key={h} className={`flex-1 text-[10px] ${AXIS_TEXT}`}>
                {hourLabel(h)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className={`mt-3 flex items-center justify-end gap-1 text-[10px] ${AXIS_TEXT}`}>
        Fewer
        {LEVELS.map((a) => (
          <span key={a} className="h-3 w-3 rounded-[3px]" style={seqFill(a)} />
        ))}
        More
      </div>
    </div>
  );
};
