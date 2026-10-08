// Item performance from COMPLETED orders. The backend usually sends no itemPrice, so:
//  - exact: itemPrice × qty, or the one unpriced line of an order (lineAmounts, same rule as the bill);
//  - estimated: an order with several unpriced lines splits what is left of its subtotal by
//    each item's typical price learned from exact sales, else by quantity.
// Revenue therefore always adds up to the order subtotals, and guesses are flagged.
import type { Order } from "../../types/order";
import { lineAmounts } from "../print/billTemplates";
import { orderGross, round2 } from "./commission";

export interface ItemRow {
  name: string;
  units: number;
  orders: number;
  revenue: number;
  estimated: boolean;
  share: number; // of total item revenue, 0..1
}

export interface ItemPair {
  a: string;
  b: string;
  orders: number;
}

export const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const displayName = (raw: string | undefined) => (raw || "Item").trim().replace(/\s+/g, " ");
const keyOf = (name: string) => name.toLowerCase();

const linesOf = (o: Order) => (o.orderItem || []).filter((it) => (it.itemCount || 0) > 0);

export const itemStats = (completed: Order[]): ItemRow[] => {
  const orders = completed.map((o) => {
    const items = linesOf(o);
    const gross = orderGross(o);
    return { items, gross, exact: lineAmounts(items, gross) };
  });

  const samples = new Map<string, number[]>();
  for (const { items, exact } of orders) {
    items.forEach((it, i) => {
      const amount = exact[i];
      if (amount === null) return;
      const key = keyOf(displayName(it.name));
      const list = samples.get(key) || [];
      list.push(amount / it.itemCount);
      samples.set(key, list);
    });
  }
  const learned = new Map([...samples].map(([k, v]) => [k, median(v) as number]));

  const rows = new Map<string, Omit<ItemRow, "share">>();
  for (const { items, gross, exact } of orders) {
    const unknown = items.map((_, i) => i).filter((i) => exact[i] === null);
    const leftover = Math.max(0, gross - exact.reduce<number>((s, a) => s + (a ?? 0), 0));
    const byPrice = unknown.every((i) => learned.has(keyOf(displayName(items[i].name))));
    const weight = (i: number) =>
      byPrice ? learned.get(keyOf(displayName(items[i].name)))! * items[i].itemCount : items[i].itemCount;
    const totalWeight = unknown.reduce((s, i) => s + weight(i), 0);

    const seenInOrder = new Set<string>();
    items.forEach((it, i) => {
      const name = displayName(it.name);
      const key = keyOf(name);
      const isEstimate = exact[i] === null;
      const amount = isEstimate ? (totalWeight > 0 ? (leftover * weight(i)) / totalWeight : 0) : (exact[i] as number);
      const row = rows.get(key) || { name, units: 0, orders: 0, revenue: 0, estimated: false };
      row.units += it.itemCount;
      row.revenue += amount;
      row.estimated = row.estimated || isEstimate;
      if (!seenInOrder.has(key)) row.orders += 1;
      seenInOrder.add(key);
      rows.set(key, row);
    });
  }

  const total = [...rows.values()].reduce((s, r) => s + r.revenue, 0);
  return [...rows.values()]
    .map((r) => ({ ...r, revenue: round2(r.revenue), share: total > 0 ? r.revenue / total : 0 }))
    .sort((x, y) => y.revenue - x.revenue || y.units - x.units || x.name.localeCompare(y.name));
};

// "Frequently bought together": item pairs that appear in the same order at least twice.
export const itemPairs = (completed: Order[], limit = 5): ItemPair[] => {
  const pairs = new Map<string, ItemPair>();
  for (const o of completed) {
    const names = new Map<string, string>();
    for (const it of linesOf(o)) {
      const name = displayName(it.name);
      if (!names.has(keyOf(name))) names.set(keyOf(name), name);
    }
    const keys = [...names.keys()].sort();
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const id = `${keys[i]}|${keys[j]}`;
        const pair = pairs.get(id) || { a: names.get(keys[i])!, b: names.get(keys[j])!, orders: 0 };
        pair.orders += 1;
        pairs.set(id, pair);
      }
    }
  }
  return [...pairs.values()]
    .filter((p) => p.orders >= 2)
    .sort((x, y) => y.orders - x.orders || x.a.localeCompare(y.a))
    .slice(0, limit);
};
