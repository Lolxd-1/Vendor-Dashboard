import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { OrderStatusFilter, TimeFilterOption } from "../../types/filters";

// ─── Constants ──────────────────────────────────────────────────
const STATUS_OPTIONS = [
  { label: "All",       value: "ALL" },
  { label: "Accepted",  value: OrderStatusFilter.ACCEPTED },
  { label: "Rejected",  value: OrderStatusFilter.REJECTED },
  { label: "Completed", value: OrderStatusFilter.COMPLETED },
  { label: "Cancelled", value: OrderStatusFilter.CANCELLED },
];

const TIME_OPTIONS = [
  { label: "Last 30 min", value: TimeFilterOption.LAST_30_MIN },
  { label: "Today",       value: TimeFilterOption.TODAY },
  { label: "Last Week",   value: TimeFilterOption.LAST_WEEK },
  { label: "Monthly",     value: TimeFilterOption.THIS_MONTH },
  { label: "Yearly",      value: TimeFilterOption.THIS_YEAR },
  { label: "Custom",      value: "CUSTOM" },
];

// ─── Props ──────────────────────────────────────────────────────
interface FilterBarProps {
  statusFilter: string;
  timeFilter: string;
  customStartDate: Date | null;
  customEndDate: Date | null;
  onStatusChange: (status: string) => void;
  onTimeChange: (time: string) => void;
  onCustomDateChange: (start: Date | null, end: Date | null) => void;
}

// ─── Shared pill classes ─────────────────────────────────────────
const pillBase =
  "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer border whitespace-nowrap active:scale-95";
const pillActive =
  "bg-[#1e40af] text-white border-[#1e40af] dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100";
const pillInactive =
  "bg-transparent text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700 dark:text-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-200";

// ─── Component ──────────────────────────────────────────────────
const FilterBar = ({
  statusFilter,
  timeFilter,
  customStartDate,
  customEndDate,
  onStatusChange,
  onTimeChange,
  onCustomDateChange,
}: FilterBarProps) => {
  return (
    <div className="space-y-3">

      {/* ─── STATUS FILTER ─────────────────────────────────────── */}
      {/* Mobile: horizontal scroll. Desktop: flex-wrap */}
      <div>
        <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2 px-4 lg:px-0">
          Status Filter
        </p>
        {/* Scroll container — hides scrollbar visually but stays functional */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-4 lg:px-0 lg:flex-wrap">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onStatusChange(opt.value)}
              className={`${pillBase} ${statusFilter === opt.value ? pillActive : pillInactive}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── TIME FILTER ───────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2 px-4 lg:px-0">
          Time Period
        </p>
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-4 lg:px-0 lg:flex-wrap">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onTimeChange(opt.value)}
              className={`${pillBase} ${timeFilter === opt.value ? pillActive : pillInactive}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── CUSTOM DATE PICKERS ─────────────────────────────── */}
      {timeFilter === "CUSTOM" && (
        <div className="flex items-center gap-2 px-4 lg:px-0">
          <DatePicker
            selected={customStartDate}
            onChange={(date: Date | null) => onCustomDateChange(date, customEndDate)}
            placeholderText="From date"
            dateFormat="dd MMM yyyy"
            maxDate={customEndDate || new Date()}
            showYearDropdown
            showMonthDropdown
            dropdownMode="select"
            className="bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 text-xs rounded-lg px-3 py-1.5 border border-slate-300 dark:border-zinc-700 outline-none w-32 focus:border-[#1e40af] dark:focus:border-zinc-500"
          />
          <span className="text-slate-400 dark:text-zinc-600 text-xs shrink-0">→</span>
          <DatePicker
            selected={customEndDate}
            onChange={(date: Date | null) => onCustomDateChange(customStartDate, date)}
            placeholderText="To date"
            dateFormat="dd MMM yyyy"
            minDate={customStartDate || undefined}
            maxDate={new Date()}
            showYearDropdown
            showMonthDropdown
            dropdownMode="select"
            className="bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 text-xs rounded-lg px-3 py-1.5 border border-slate-300 dark:border-zinc-700 outline-none w-32 focus:border-[#1e40af] dark:focus:border-zinc-500"
          />
        </div>
      )}
    </div>
  );
};

export default FilterBar;
