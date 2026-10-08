// Date ranges for the Analytics page. Every range is half-open [start, end) in the
// vendor's local time, so "Sunday 23:59:59" is in a week and "Monday 00:00" starts the next.
// QuickVerse settles Monday 00:00 → Sunday 23:59 and pays out the Monday after.

export interface DateRange {
  start: Date;
  end: Date;
}

export type PeriodPreset =
  | "SETTLEMENT_WEEK"
  | "TODAY"
  | "YESTERDAY"
  | "LAST_30_DAYS"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_YEAR"
  | "ALL_TIME"
  | "CUSTOM";

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// setDate, not +86400000 ms, so a day is always a calendar day.
export const addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

// Monday = 0 … Sunday = 6 (Date#getDay starts the week on Sunday).
export const weekdayIndex = (d: Date): number => (d.getDay() + 6) % 7;

export const settlementWeekOf = (d: Date): DateRange => {
  const start = addDays(startOfDay(d), -weekdayIndex(d));
  return { start, end: addDays(start, 7) };
};

// The week ends Sunday night; the money lands the next day.
export const payoutDateOf = (week: DateRange): Date => week.end;

export const presetRange = (
  preset: "TODAY" | "YESTERDAY" | "LAST_30_DAYS" | "THIS_MONTH" | "LAST_MONTH" | "THIS_YEAR",
  now: Date
): DateRange => {
  const today = startOfDay(now);
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "TODAY":
      return { start: today, end: addDays(today, 1) };
    case "YESTERDAY":
      return { start: addDays(today, -1), end: today };
    case "LAST_30_DAYS":
      return { start: addDays(today, -29), end: addDays(today, 1) };
    case "THIS_MONTH":
      return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
    case "LAST_MONTH":
      return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
    case "THIS_YEAR":
      return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
  }
};

const isMonthStart = (d: Date) =>
  d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;

const shiftMonths = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth() + n, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());

// The period to compare against: the same stretch one period earlier, cut at "now" so a
// running week is compared with the same days of last week, not with a whole week.
export const previousRange = (r: DateRange, now: Date): DateRange => {
  const effEnd = r.end > now ? now : r.end;
  let start: Date;
  let end: Date;
  if (isMonthStart(r.start) && isMonthStart(r.end)) {
    const months = (r.end.getFullYear() - r.start.getFullYear()) * 12 + r.end.getMonth() - r.start.getMonth();
    start = shiftMonths(r.start, -months);
    end = shiftMonths(effEnd, -months);
  } else {
    const days = Math.round((startOfDay(r.end).getTime() - startOfDay(r.start).getTime()) / 86_400_000);
    start = addDays(r.start, -days);
    end = addDays(effEnd, -days);
  }
  return { start, end: end > r.start ? r.start : end };
};

// Backend sends "2026-09-20 18:01:57.678" with no zone: local time, as everywhere else in the app.
export const parseOrderTime = (value?: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(String(value).trim().replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
};

export const inRange = (d: Date, r: DateRange): boolean => d >= r.start && d < r.end;
