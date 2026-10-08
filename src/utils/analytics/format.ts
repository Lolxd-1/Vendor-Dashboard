// Display formatting shared by the Analytics page and the PDF report.
// Date names are spelled out by hand: Intl date output differs between browsers.
import { addDays, type DateRange } from "./period";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Monday first, matching settlement weeks and weekdayIndex.
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const WHOLE = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const EXACTLY_2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const UP_TO_1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

const sign = (n: number) => (n < 0 ? "-" : "");

// "₹6,200" or "₹2,265.50" — Indian digit grouping; paise shown only when there are some.
export const inr = (n: number): string => {
  const paise = Math.round(Math.abs(n) * 100);
  if (paise === 0) return "₹0";
  return `${sign(n)}₹${paise % 100 === 0 ? WHOLE.format(paise / 100) : EXACTLY_2.format(paise / 100)}`;
};

// The PDF's built-in fonts have no ₹ glyph, so the report writes "Rs 1,234.00".
export const rs = (n: number): string => `${sign(n)}Rs ${EXACTLY_2.format(Math.abs(n))}`;

export const pctText = (fraction: number): string => `${UP_TO_1.format(fraction * 100)}%`;

// Chart axis ticks: "₹950", "₹12k", "₹1.2L", "₹3Cr" (lakh and crore, as vendors count).
export const compactInr = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e7) return `${sign(n)}₹${UP_TO_1.format(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign(n)}₹${UP_TO_1.format(a / 1e5)}L`;
  if (a >= 1e3) return `${sign(n)}₹${UP_TO_1.format(a / 1e3)}k`;
  return inr(n);
};

// Round axis steps (1, 2, 2.5, 5 × 10ⁿ) so ticks read ₹0 / ₹500 / ₹1k, not ₹0 / ₹437.
export const niceStep = (raw: number): number => {
  const p = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => raw <= m * p) ?? 10) * p;
};

const PAYMENT_LABELS: Record<string, string> = {
  COD: "Cash on delivery",
  PREPAID: "Prepaid",
  QR_CODE: "QR code",
  ONLINE: "Online",
  UNKNOWN: "Not recorded",
};

export const paymentLabel = (method: string): string =>
  PAYMENT_LABELS[method] ?? method.charAt(0) + method.slice(1).toLowerCase().replace(/_/g, " ");

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
