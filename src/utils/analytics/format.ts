// Display formatting shared by the Analytics page and the PDF report.
// Date names are spelled out by hand: Intl date output differs between browsers.
import { addDays, type DateRange } from "./period";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const UP_TO_2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const EXACTLY_2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const UP_TO_1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

const sign = (n: number) => (n < 0 ? "-" : "");

// "₹1,23,456.5" — Indian digit grouping.
export const inr = (n: number): string => `${sign(n)}₹${UP_TO_2.format(Math.abs(n))}`;

// The PDF's built-in fonts have no ₹ glyph, so the report writes "Rs 1,234.00".
export const rs = (n: number): string => `${sign(n)}Rs ${EXACTLY_2.format(Math.abs(n))}`;

export const pctText = (fraction: number): string => `${UP_TO_1.format(fraction * 100)}%`;

// Change as a fraction (0.2 = +20%); null when there is nothing to compare with.
export const deltaPct = (cur: number, prev: number): number | null => (prev > 0 ? (cur - prev) / prev : null);

const pad = (n: number) => String(n).padStart(2, "0");

export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const dayLabel = (d: Date): string => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

export const monthLabel = (d: Date): string => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

export const hourLabel = (h: number): string => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;

// Ranges end at midnight of the day after, so the last day shown is end − 1 day.
export const rangeLabel = (r: DateRange): string => {
  const last = addDays(r.end, -1);
  if (last <= r.start) return `${dayLabel(r.start)} ${r.start.getFullYear()}`;
  const startYear = r.start.getFullYear() === last.getFullYear() ? "" : ` ${r.start.getFullYear()}`;
  return `${dayLabel(r.start)}${startYear} – ${dayLabel(last)} ${last.getFullYear()}`;
};
