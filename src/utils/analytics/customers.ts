// Customer analytics from COMPLETED orders across the whole history, so "new" means
// first-ever order with this shop, not just first order inside the selected period.
import type { Order } from "../../types/order";
import { orderGross, round2 } from "./commission";
import { monthLabel, ymd } from "./format";
import { inRange, parseOrderTime, type DateRange } from "./period";

export type SegmentKey = "champions" | "repeat" | "new" | "atRisk" | "lapsed";

export interface CustomerRow {
  key: string;
  name: string;
  phoneTail: string;
  orders: number;
  spend: number;
  lastOrder: Date;
  isNew: boolean;
}

export interface CustomerStats {
  unique: number;
  newCount: number;
  returningCount: number;
  repeatCount: number; // 2+ orders inside the period
  newSales: number;
  returningSales: number;
  repeatRate: number; // repeatCount / unique, 0..1
  top: CustomerRow[];
  segments: Record<SegmentKey, number>;
}

export interface CohortRow {
  month: string; // "2026-07"
  label: string; // "Jul 2026"
  size: number;
  retained: number[]; // [0] = share who ordered again 1 month later, [1] = 2 months later, …
}

const DAY_MS = 86_400_000;

export const customerKey = (o: Order): string => {
  const id = o.customerId;
  if (id !== undefined && id !== null && String(id).trim() !== "" && String(id) !== "0") return `id:${id}`;
  const phone = String(o.customerMobile ?? "").replace(/\D/g, "");
  if (phone) return `ph:${phone.slice(-10)}`;
  const name = (o.customerName || "").trim().toLowerCase();
  return name ? `nm:${name}` : "";
};

const phoneTail = (o: Order) => String(o.customerMobile ?? "").replace(/\D/g, "").slice(-4);

// Completed orders with a readable time and a customer identity, oldest first.
const timeline = (orders: Order[]) =>
  orders
    .map((o) => ({ o, t: parseOrderTime(o.creationTime), key: customerKey(o) }))
    .filter((x): x is { o: Order; t: Date; key: string } => x.t !== null && x.key !== "")
    .sort((a, b) => a.t.getTime() - b.t.getTime());

const segmentOf = (orders: number, daysSinceLast: number): SegmentKey => {
  if (daysSinceLast > 60) return "lapsed";
  if (daysSinceLast > 30) return "atRisk";
  if (orders >= 3) return "champions";
  return orders === 2 ? "repeat" : "new";
};

export const customerStats = (allCompleted: Order[], range: DateRange, now: Date): CustomerStats => {
  const events = timeline(allCompleted);
  const first = new Map<string, Date>();
  const rows = new Map<string, CustomerRow>();
  const asOf = range.end < now ? range.end : now;
  const life = new Map<string, { orders: number; last: Date }>();

  for (const { o, t, key } of events) {
    if (!first.has(key)) first.set(key, t);
    if (t < asOf) life.set(key, { orders: (life.get(key)?.orders || 0) + 1, last: t });
    if (!inRange(t, range)) continue;
    const row = rows.get(key) || {
      key,
      name: "",
      phoneTail: "",
      orders: 0,
      spend: 0,
      lastOrder: t,
      isNew: first.get(key)! >= range.start,
    };
    row.orders += 1;
    row.spend += orderGross(o);
    row.lastOrder = t;
    row.name = (o.customerName || "").trim() || row.name;
    row.phoneTail = phoneTail(o) || row.phoneTail;
    rows.set(key, row);
  }

  const list = [...rows.values()].map((r) => ({ ...r, spend: round2(r.spend) }));
  const newRows = list.filter((r) => r.isNew);
  const sales = (rs: CustomerRow[]) => round2(rs.reduce((s, r) => s + r.spend, 0));
  const repeatCount = list.filter((r) => r.orders >= 2).length;

  const segments: Record<SegmentKey, number> = { champions: 0, repeat: 0, new: 0, atRisk: 0, lapsed: 0 };
  for (const { orders, last } of life.values()) {
    segments[segmentOf(orders, (asOf.getTime() - last.getTime()) / DAY_MS)] += 1;
  }

  return {
    unique: list.length,
    newCount: newRows.length,
    returningCount: list.length - newRows.length,
    repeatCount,
    newSales: sales(newRows),
    returningSales: sales(list.filter((r) => !r.isNew)),
    repeatRate: list.length ? repeatCount / list.length : 0,
    top: [...list].sort((a, b) => b.spend - a.spend || b.orders - a.orders).slice(0, 10),
    segments,
  };
};

const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();

// Classic monthly cohorts: customers grouped by the month of their first order, then the
// share of each group that ordered again 1, 2, 3 … months later.
export const cohortRetention = (allCompleted: Order[], now: Date, maxCohorts = 6): CohortRow[] => {
  const active = new Map<string, Set<number>>();
  const firstMonth = new Map<string, number>();
  for (const { t, key } of timeline(allCompleted)) {
    const m = monthIndex(t);
    if (!firstMonth.has(key)) firstMonth.set(key, m);
    active.set(key, (active.get(key) || new Set<number>()).add(m));
  }

  const cohorts = new Map<number, string[]>();
  for (const [key, m] of firstMonth) cohorts.set(m, [...(cohorts.get(m) || []), key]);

  const nowMonth = monthIndex(now);
  return [...cohorts.keys()]
    .sort((a, b) => a - b)
    .slice(-maxCohorts)
    .map((m) => {
      const keys = cohorts.get(m)!;
      const retained: number[] = [];
      for (let k = 1; m + k <= nowMonth; k++) {
        retained.push(keys.filter((key) => active.get(key)!.has(m + k)).length / keys.length);
      }
      const start = new Date(Math.floor(m / 12), m % 12, 1);
      return { month: ymd(start).slice(0, 7), label: monthLabel(start), size: keys.length, retained };
    });
};
