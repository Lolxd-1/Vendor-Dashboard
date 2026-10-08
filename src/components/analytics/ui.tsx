import type { ReactNode } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { pctText } from "../../utils/analytics/format";
import { BAD_TEXT, GOOD_TEXT } from "./colors";

export const Panel = ({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section
    className={`rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-4 lg:p-5 min-w-0 ${className}`}
  >
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

// Change vs the previous period. Arrow + sign + colour, so it never relies on colour alone.
export const Delta = ({ value, upIsGood = true }: { value: number | null; upIsGood?: boolean }) => {
  if (value === null) {
    return <span className="text-[11px] text-slate-400 dark:text-zinc-500">No earlier data</span>;
  }
  if (Math.abs(value) < 0.0005) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-zinc-400">
        <Minus size={12} aria-hidden /> Same as before
      </span>
    );
  }
  const up = value > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${up === upIsGood ? GOOD_TEXT : BAD_TEXT}`}>
      <Icon size={12} aria-hidden />
      {up ? "+" : "−"}
      {pctText(Math.abs(value))}
      <span className="font-normal text-slate-400 dark:text-zinc-500">vs prev.</span>
    </span>
  );
};

export const StatTile = ({
  label,
  value,
  delta,
  upIsGood,
  hint,
}: {
  label: string;
  value: string;
  delta: number | null;
  upIsGood?: boolean;
  hint?: string;
}) => (
  <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 lg:p-4 shadow-sm min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">{label}</p>
    <p className="mt-1 text-xl lg:text-2xl font-black text-slate-900 dark:text-zinc-100 truncate">{value}</p>
    <div className="mt-1">
      <Delta value={delta} upIsGood={upIsGood} />
    </div>
    {hint && <p className="mt-0.5 text-[11px] text-slate-400 dark:text-zinc-500 truncate">{hint}</p>}
  </div>
);

export interface Segment {
  label: string;
  value: number;
  color: string;
  display?: string;
}

// Part-to-whole as one thin bar (2px surface gap between parts) plus a legend with numbers.
export const SplitBar = ({ segments, ariaLabel }: { segments: Segment[]; ariaLabel: string }) => {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <EmptyNote text="No data for this period." />;
  return (
    <div>
      <div role="img" aria-label={ariaLabel} className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div key={s.label} className={s.color} style={{ width: `${(s.value / total) * 100}%` }} />
          ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2 text-slate-600 dark:text-zinc-300 min-w-0">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${s.color}`} aria-hidden />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="shrink-0 font-semibold text-slate-900 dark:text-zinc-100 tabular-nums">
              {s.display ?? s.value}{" "}
              <span className="font-normal text-slate-400 dark:text-zinc-500">({pctText(s.value / total)})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const EmptyNote = ({ text }: { text: string }) => (
  <p className="py-6 text-center text-xs text-slate-400 dark:text-zinc-500">{text}</p>
);
