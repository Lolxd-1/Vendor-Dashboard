// One report object feeds both the Analytics page and the PDF, so the two can never disagree.
// Money counts COMPLETED orders only; order counts include every status. Every total is the
// sum of per-order values, so the summary always matches the order-by-order annexure.
import type { Order } from "../../types/order";
import { commissionOf, orderGross, round2 } from "./commission";
import { cohortRetention, customerKey, customerStats, type CohortRow, type CustomerStats } from "./customers";
import { dayLabel, deltaPct, hourLabel, inr, monthLabel, pctText, ymd } from "./format";
import { itemPairs, itemStats, median, type ItemPair, type ItemRow } from "./items";
import {
  addDays,
  inRange,
  parseOrderTime,
  payoutDateOf,
  previousRange,
  settlementWeekOf,
  startOfDay,
  weekdayIndex,
  type DateRange,
} from "./period";

export type OrderBucket = "completed" | "cancelled" | "rejected" | "open";

export interface Kpis {
  orders: number;
  completed: number;
  cancelled: number;
  rejected: number;
  open: number;
  gross: number;
  commission: number;
  net: number;
  aov: number;
  itemsSold: number;
  lostValue: number;
  customers: number;
  completionRate: number;
  cancelRate: number;
  rejectRate: number;
}

export interface SeriesPoint {
  key: string;
  label: string;
  start: Date;
  orders: number;
  completed: number;
  gross: number;
  net: number;
}

export interface SettlementWeek {
  range: DateRange;
  payoutDate: Date;
  completed: number;
  gross: number;
  commission: number;
  net: number;
  settledOrders: number;
  status: "in_progress" | "settled" | "pending" | "empty";
}

export interface PaymentSplit {
  method: string;
  orders: number;
  gross: number;
}

export interface Insight {
  tone: "good" | "warn" | "info";
  text: string;
}

export interface AnalyticsReport {
  range: DateRange;
  previous: DateRange;
  commissionPct: number;
  generatedAt: Date;
  kpis: Kpis;
  previousKpis: Kpis;
  series: { grain: "day" | "month"; points: SeriesPoint[] };
  items: ItemRow[];
  pairs: ItemPair[];
  customers: CustomerStats;
  cohorts: CohortRow[];
  heatmap: { cells: number[][]; max: number };
  payments: PaymentSplit[];
  timing: { medianAcceptMin: number | null; medianPrepMin: number | null };
  settlements: SettlementWeek[];
  insights: Insight[];
  orders: Order[]; // in the period, newest first
}

export const bucketOf = (state: unknown): OrderBucket => {
  const s = typeof state === "string" ? state.trim().toUpperCase() : "";
  if (s === "COMPLETED") return "completed";
  if (s === "CANCELLED") return "cancelled";
  if (s === "REJECTED") return "rejected";
  return "open";
};

type Timed = { o: Order; t: Date };

const DAY_MS = 86_400_000;

const timed = (orders: Order[]): Timed[] =>
  orders.map((o) => ({ o, t: parseOrderTime(o.creationTime) })).filter((x): x is Timed => x.t !== null);

const isCompleted = (o: Order) => bucketOf(o.state) === "completed";

const unitsOf = (o: Order) =>
  o.orderItem?.length ? o.orderItem.reduce((s, it) => s + (it.itemCount || 0), 0) : Number(o.totalItemCount) || 0;

const moneyOf = (completed: Order[], pct: number) => {
  let gross = 0;
  let commission = 0;
  for (const o of completed) {
    const g = orderGross(o);
    gross += g;
    commission += commissionOf(g, pct);
  }
  return { gross: round2(gross), commission: round2(commission), net: round2(gross - commission) };
};

const kpisOf = (orders: Order[], pct: number): Kpis => {
  const by: Record<OrderBucket, Order[]> = { completed: [], cancelled: [], rejected: [], open: [] };
  for (const o of orders) by[bucketOf(o.state)].push(o);
  const n = orders.length;
  const done = by.completed.length;
  const { gross, commission, net } = moneyOf(by.completed, pct);
  return {
    orders: n,
    completed: done,
    cancelled: by.cancelled.length,
    rejected: by.rejected.length,
    open: by.open.length,
    gross,
    commission,
    net,
    aov: done ? round2(gross / done) : 0,
    itemsSold: by.completed.reduce((s, o) => s + unitsOf(o), 0),
    lostValue: round2([...by.cancelled, ...by.rejected].reduce((s, o) => s + orderGross(o), 0)),
    customers: new Set(by.completed.map(customerKey).filter(Boolean)).size,
    completionRate: n ? done / n : 0,
    cancelRate: n ? by.cancelled.length / n : 0,
    rejectRate: n ? by.rejected.length / n : 0,
  };
};

// Daily bars up to ~2 months, monthly beyond that; empty days/months are kept as zeros.
const seriesOf = (rows: Timed[], range: DateRange, pct: number): AnalyticsReport["series"] => {
  const days = Math.round((startOfDay(range.end).getTime() - startOfDay(range.start).getTime()) / DAY_MS);
  const grain = days <= 62 ? "day" : "month";
  const keyOf = (d: Date) => (grain === "day" ? ymd(d) : ymd(d).slice(0, 7));
  const next = (d: Date) => (grain === "day" ? addDays(d, 1) : new Date(d.getFullYear(), d.getMonth() + 1, 1));

  const points: SeriesPoint[] = [];
  let d = grain === "day" ? startOfDay(range.start) : new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  for (; d < range.end; d = next(d)) {
    const label = grain === "day" ? dayLabel(d) : monthLabel(d);
    points.push({ key: keyOf(d), label, start: d, orders: 0, completed: 0, gross: 0, net: 0 });
  }

  const index = new Map(points.map((p, i) => [p.key, i]));
  for (const { o, t } of rows) {
    const i = index.get(keyOf(t));
    if (i === undefined) continue;
    const p = points[i];
    p.orders += 1;
    if (!isCompleted(o)) continue;
    const g = orderGross(o);
    p.completed += 1;
    p.gross += g;
    p.net += g - commissionOf(g, pct);
  }
  return { grain, points: points.map((p) => ({ ...p, gross: round2(p.gross), net: round2(p.net) })) };
};

const heatmapOf = (rows: Timed[]) => {
  const cells = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const { t } of rows) cells[weekdayIndex(t)][t.getHours()] += 1;
  return { cells, max: Math.max(0, ...cells.flat()) };
};

const paymentsOf = (completed: Order[]): PaymentSplit[] => {
  const map = new Map<string, PaymentSplit>();
  for (const o of completed) {
    const method = (o.paymentMethod || "").trim().toUpperCase() || "UNKNOWN";
    const p = map.get(method) || { method, orders: 0, gross: 0 };
    p.orders += 1;
    p.gross += orderGross(o);
    map.set(method, p);
  }
  return [...map.values()]
    .map((p) => ({ ...p, gross: round2(p.gross) }))
    .sort((a, b) => b.orders - a.orders || b.gross - a.gross);
};

const minutesBetween = (from?: string | null, to?: string | null): number | null => {
  const a = parseOrderTime(from);
  const b = parseOrderTime(to);
  if (!a || !b) return null;
  const m = (b.getTime() - a.getTime()) / 60_000;
  return m > 0 ? m : null;
};

// Medians, not averages: one order accepted two days late must not hide a fast kitchen.
const timingOf = (orders: Order[]): AnalyticsReport["timing"] => {
  const valid = (xs: (number | null)[]) => xs.filter((m): m is number => m !== null);
  const oneDecimal = (m: number | null) => (m === null ? null : Math.round(m * 10) / 10);
  return {
    medianAcceptMin: oneDecimal(median(valid(orders.map((o) => minutesBetween(o.creationTime, o.acceptedDate))))),
    medianPrepMin: oneDecimal(median(valid(orders.map((o) => minutesBetween(o.acceptedDate, o.readyDate))))),
  };
};

// Current settlement week first, then the weeks before it.
export const settlementWeeks = (all: Order[], pct: number, now: Date, count = 8): SettlementWeek[] => {
  const byWeek = new Map<string, Order[]>();
  for (const { o, t } of timed(all.filter(isCompleted))) {
    const key = ymd(settlementWeekOf(t).start);
    const list = byWeek.get(key) || [];
    list.push(o);
    byWeek.set(key, list);
  }

  const current = settlementWeekOf(now);
  return Array.from({ length: count }, (_, i) => {
    const start = addDays(current.start, -7 * i);
    const range = { start, end: addDays(start, 7) };
    const orders = byWeek.get(ymd(start)) || [];
    const settledOrders = orders.filter((o) => o.isSettled === true).length;
    const status: SettlementWeek["status"] =
      now < range.end ? "in_progress" : orders.length === 0 ? "empty" : settledOrders === orders.length ? "settled" : "pending";
    return { range, payoutDate: payoutDateOf(range), completed: orders.length, ...moneyOf(orders, pct), settledOrders, status };
  });
};

export const allTimeRange = (all: Order[], now: Date): DateRange => {
  let first = now;
  for (const { t } of timed(all)) if (t < first) first = t;
  return { start: startOfDay(first), end: addDays(startOfDay(now), 1) };
};

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const insightsOf = (
  k: Kpis,
  prev: Kpis,
  items: ItemRow[],
  customers: CustomerStats,
  heatmap: AnalyticsReport["heatmap"],
  timing: AnalyticsReport["timing"]
): Insight[] => {
  if (k.orders === 0) return [{ tone: "info", text: "No orders in this period." }];
  const out: Insight[] = [];

  const change = deltaPct(k.gross, prev.gross);
  if (change !== null) {
    out.push({
      tone: change >= 0 ? "good" : "warn",
      text: `Sales ${change >= 0 ? "up" : "down"} ${pctText(Math.abs(change))} vs the previous period (${inr(k.gross)} vs ${inr(prev.gross)}).`,
    });
  }

  if (heatmap.max >= 2) {
    const i = heatmap.cells.flat().indexOf(heatmap.max);
    const h = i % 24;
    out.push({
      tone: "info",
      text: `Busiest time: ${WEEKDAY_NAMES[Math.floor(i / 24)]} ${hourLabel(h)}–${hourLabel((h + 1) % 24)} (${count(heatmap.max, "order")}). Keep the kitchen ready then.`,
    });
  }

  const best = items[0];
  if (best && best.revenue > 0) {
    out.push({ tone: "good", text: `Best seller: ${best.name} — ${best.units} sold, ${pctText(best.share)} of item sales.` });
  }

  const customerSales = customers.newSales + customers.returningSales;
  if (customers.unique >= 3 && customerSales > 0) {
    const share = customers.returningSales / customerSales;
    out.push({
      tone: share >= 0.3 ? "good" : "info",
      text: `Returning customers brought ${pctText(share)} of sales; ${count(customers.newCount, "new customer")} ordered for the first time.`,
    });
  }

  const lost = k.cancelled + k.rejected;
  if (lost > 0) {
    out.push({
      tone: lost / k.orders > 0.05 ? "warn" : "info",
      text: `${count(lost, "order")} ${lost === 1 ? "was" : "were"} cancelled or rejected (${pctText(lost / k.orders)} of orders) — ${inr(k.lostValue)} in lost sales.`,
    });
  }

  const atRisk = customers.segments.atRisk;
  if (atRisk > 0) {
    out.push({
      tone: "warn",
      text: `${count(atRisk, "customer")} ${atRisk === 1 ? "hasn't" : "haven't"} ordered in 30–60 days — a small offer can win them back.`,
    });
  }

  if (timing.medianAcceptMin !== null && timing.medianAcceptMin > 5) {
    out.push({
      tone: "warn",
      text: `Orders wait a median ${timing.medianAcceptMin} min to be accepted — faster acceptance cuts cancellations.`,
    });
  }
  return out;
};

export const buildReport = (all: Order[], range: DateRange, pct: number, now: Date): AnalyticsReport => {
  const rows = timed(all);
  const previous = previousRange(range, now);
  const current = rows.filter((x) => inRange(x.t, range)).sort((a, b) => b.t.getTime() - a.t.getTime());
  const orders = current.map((x) => x.o);
  const completed = orders.filter(isCompleted);
  const allCompleted = all.filter(isCompleted);

  const kpis = kpisOf(orders, pct);
  const previousKpis = kpisOf(rows.filter((x) => inRange(x.t, previous)).map((x) => x.o), pct);
  const items = itemStats(completed);
  const customers = customerStats(allCompleted, range, now);
  const heatmap = heatmapOf(current);
  const timing = timingOf(orders);

  return {
    range,
    previous,
    commissionPct: pct,
    generatedAt: now,
    kpis,
    previousKpis,
    series: seriesOf(current, range, pct),
    items,
    pairs: itemPairs(completed),
    customers,
    cohorts: cohortRetention(allCompleted, now),
    heatmap,
    payments: paymentsOf(completed),
    timing,
    settlements: settlementWeeks(all, pct, now),
    insights: insightsOf(kpis, previousKpis, items, customers, heatmap, timing),
    orders,
  };
};
