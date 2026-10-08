import { describe, expect, it } from "vitest";
import type { Order } from "../../../types/order";
import { itemPairs, itemStats, median } from "../items";

type Line = { name: string; itemCount: number; itemPrice?: number };
const order = (id: string, gross: number, items: Line[]) =>
  ({
    orderId: id,
    state: "COMPLETED",
    creationTime: "2026-10-06 12:00:00",
    amountExcludingDeliveryFee: gross,
    orderItem: items.map((it, i) => ({ id: i, ...it })),
  }) as unknown as Order;

const SHAWARMA = "Chicken Shawarma Combo";
const BIRYANI = "Chicken Biryani Full";

// Shawarma's price (110) is learned from O1/O2, Biryani's (130) from O4; O3 has both unpriced.
const O1 = order("O1", 110, [{ name: SHAWARMA, itemCount: 1 }]);
const O2 = order("O2", 220, [{ name: SHAWARMA, itemCount: 2 }]);
const O3 = order("O3", 480, [
  { name: BIRYANI, itemCount: 2 },
  { name: " chicken shawarma  combo ", itemCount: 2 },
]);
const O4 = order("O4", 130, [{ name: BIRYANI, itemCount: 1 }]);

describe("itemStats", () => {
  it("TC1: single-item orders give exact revenue", () => {
    expect(itemStats([O1, O2])).toEqual([
      { name: SHAWARMA, units: 3, orders: 2, revenue: 330, estimated: false, share: 1 },
    ]);
  });

  it("TC2: several unpriced lines split the subtotal by learned prices, flagged estimated", () => {
    const rows = itemStats([O1, O2, O3, O4]);
    expect(rows.map((r) => [r.name, r.units, r.orders, r.revenue, r.estimated])).toEqual([
      [SHAWARMA, 5, 3, 550, true], // 110 + 220 + 220 (2 × 110 of O3's 480)
      [BIRYANI, 3, 2, 390, true], //  260 (2 × 130 of O3's 480) + 130
    ]);
  });

  it("TC3: with no learned price, unpriced lines split by quantity", () => {
    const rows = itemStats([order("O6", 100, [{ name: "A", itemCount: 1 }, { name: "B", itemCount: 3 }])]);
    expect(rows.map((r) => [r.name, r.revenue, r.estimated])).toEqual([
      ["B", 75, true],
      ["A", 25, true],
    ]);
  });

  it("TC4: itemPrice is exact, and one unpriced line gets the rest of the subtotal", () => {
    const rows = itemStats([
      order("O5", 90, [{ name: "Noodles", itemCount: 1, itemPrice: 90 }]),
      order("O8", 200, [{ name: "X", itemCount: 1, itemPrice: 50 }, { name: "Y", itemCount: 2 }]),
    ]);
    expect(rows.map((r) => [r.name, r.revenue, r.estimated])).toEqual([
      ["Y", 150, false],
      ["Noodles", 90, false],
      ["X", 50, false],
    ]);
  });

  it("TC4: names merge ignoring case and spaces; the first spelling is shown", () => {
    const rows = itemStats([O1, O3]);
    expect(rows.find((r) => r.name === SHAWARMA)?.units).toBe(3);
    expect(rows).toHaveLength(2);
  });

  it("TC5: revenue adds up to the order subtotals and shares to 1", () => {
    const rows = itemStats([O1, O2, O3, O4]);
    expect(rows.reduce((s, r) => s + r.revenue, 0)).toBe(110 + 220 + 480 + 130);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1);
  });

  it("ignores zero-quantity lines and handles no orders", () => {
    expect(itemStats([order("O9", 0, [{ name: "Z", itemCount: 0 }])])).toEqual([]);
    expect(itemStats([])).toEqual([]);
  });
});

describe("itemPairs (TC6)", () => {
  it("lists pairs bought together in 2+ orders, most frequent first", () => {
    const O7 = order("O7", 240, [{ name: BIRYANI, itemCount: 1 }, { name: SHAWARMA, itemCount: 1 }]);
    const O6 = order("O6", 100, [{ name: "A", itemCount: 1 }, { name: "B", itemCount: 3 }]);
    expect(itemPairs([O7, O3, O6, O1])).toEqual([{ a: BIRYANI, b: SHAWARMA, orders: 2 }]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 3 }, (_, i) =>
      order(`P${i}`, 10, [{ name: "A", itemCount: 1 }, { name: "B", itemCount: 1 }, { name: "C", itemCount: 1 }])
    );
    expect(itemPairs(many, 2)).toHaveLength(2);
  });
});

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
