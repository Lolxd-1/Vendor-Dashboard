import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { payoutDateOf, type DateRange, type PeriodPreset } from "../../utils/analytics/period";
import { dayLabel, rangeLabel } from "../../utils/analytics/format";

const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "SETTLEMENT_WEEK", label: "Settlement week" },
  { value: "TODAY", label: "Today" },
  { value: "YESTERDAY", label: "Yesterday" },
  { value: "LAST_30_DAYS", label: "Last 30 days" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "THIS_YEAR", label: "This year" },
  { value: "ALL_TIME", label: "All time" },
  { value: "CUSTOM", label: "Custom" },
];

// Same pill look as Order History's FilterBar.
const pillBase =
  "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer border whitespace-nowrap active:scale-95";
const pillActive = "bg-[#1e40af] text-white border-[#1e40af] dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100";
const pillInactive =
  "bg-transparent text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700 dark:text-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-200";
const dateInput =
  "bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 text-xs rounded-lg px-3 py-1.5 border border-slate-300 dark:border-zinc-700 outline-none w-32 focus:border-[#1e40af] dark:focus:border-zinc-500";
const arrow =
  "p-2 rounded-lg border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors";

export const PeriodBar = ({
  preset,
  onPreset,
  week,
  weekOffset,
  onWeekShift,
  customStart,
  customEnd,
  onCustomChange,
}: {
  preset: PeriodPreset;
  onPreset: (p: PeriodPreset) => void;
  week: DateRange | null;
  weekOffset: number;
  onWeekShift: (delta: number) => void;
  customStart: Date | null;
  customEnd: Date | null;
  onCustomChange: (start: Date | null, end: Date | null) => void;
}) => (
  <div className="space-y-3">
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar lg:flex-wrap">
      {PRESETS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onPreset(p.value)}
          aria-pressed={preset === p.value}
          className={`${pillBase} ${preset === p.value ? pillActive : pillInactive}`}
        >
          {p.label}
        </button>
      ))}
    </div>

    {preset === "SETTLEMENT_WEEK" && week && (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2">
        <button type="button" aria-label="Previous settlement week" className={arrow} onClick={() => onWeekShift(-1)}>
          <ChevronLeft size={16} />
        </button>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-bold text-slate-900 dark:text-zinc-100">{rangeLabel(week)}</p>
          <p className="text-[11px] text-slate-500 dark:text-zinc-400">
            {weekOffset === 0 ? "Current week · next payout" : "Payout"} {dayLabel(payoutDateOf(week))}
          </p>
        </div>
        <button
          type="button"
          aria-label="Next settlement week"
          className={arrow}
          disabled={weekOffset >= 0}
          onClick={() => onWeekShift(1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    )}

    {preset === "CUSTOM" && (
      <div className="flex items-center gap-2">
        <DatePicker
          selected={customStart}
          onChange={(date: Date | null) => onCustomChange(date, customEnd)}
          placeholderText="From date"
          dateFormat="dd MMM yyyy"
          maxDate={customEnd || new Date()}
          showYearDropdown
          showMonthDropdown
          dropdownMode="select"
          className={dateInput}
        />
        <span className="shrink-0 text-xs text-slate-400 dark:text-zinc-600">→</span>
        <DatePicker
          selected={customEnd}
          onChange={(date: Date | null) => onCustomChange(customStart, date)}
          placeholderText="To date"
          dateFormat="dd MMM yyyy"
          minDate={customStart || undefined}
          maxDate={new Date()}
          showYearDropdown
          showMonthDropdown
          dropdownMode="select"
          className={dateInput}
        />
      </div>
    )}
  </div>
);
