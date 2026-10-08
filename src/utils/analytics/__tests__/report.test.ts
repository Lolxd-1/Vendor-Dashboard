import { describe, expect, it } from "vitest";
import type { Order } from "../../../types/order";
import { presetRange, settlementWeekOf } from "../period";
import { allTimeRange, bucketOf, buildReport, settlementWeeks } from "../report";

const order = (id: string, state: string, creationTime: string, gross: number, extra: Partial<Order> = {}) =>
  ({
    orderId: id,
    state,
    creationTime,
    amountExcludingDeliveryFee: gross,
    customerId: 0,
    orderItem: [],
    totalItemCount: 0,
    paymentMethod: "COD",
    isSettled: false,
    ...extra,
  }) as unknown as Order;

const NOW = new Date(2026, 9, 8, 15); // Thu 8 Oct 2026, 3 PM
const WEEK = settlementWeekOf(NOW); // Mon 5 Oct → Mon 12 Oct, paid Mon 12 Oct

const ORDERS = [
  order("A", "COMPLETED", "2026-10-05 10:00:00", 110, {
    customerId: 1,
    orderItem: [{ id: 1, name: "Chicken Shawarma Combo", itemCount: 1 }],
    acceptedDate: "2026-10-05 10:02:00",
    readyDate: "2026-10-05 10:20:00",
  }),
  order("B", "COMPLETED", "2026-10-06 19:30:00", 89.1, {
    customerId: 2,
    totalItemCount: 1,
    paymentMethod: " prepaid ",
    acceptedDate: "2026-10-06 19:34:00",
    readyDate: "2026-10-06 19:50:00",
  }),
  order("C", "CANCELLED", "2026-10-06 20:00:00", 256, { customerId: 3 }),
  order("D", "REJECTED", "2026-10-07 21:00:00", 83, { customerId: 4 }),
  order("E", "READY_FOR_PICKUP", "2026-10-08 12:00:00", 236, {
    customerId: 5,
    acceptedDate: "2026-10-08 11:50:00", // before creation: ignored
  }),
  order("F", "COMPLETED", "2026-10-07 19:10:00", 45.55, {
    customerId: 1,
    orderItem: [{ id: 2, name: "Chicken Biryani (half)", itemCount: 2 }],
  }),
  order("G", "COMPLETED", "2026-09-29 12:00:00", 200, { customerId: 1 }), // previous period
  order("H", "COMPLETED", "2026-10-02 12:00:00", 1000, { customerId: 9, isSettled: true }), // in neither period
  order("I", "COMPLETED", "", 500, { customerId: 10 }), // unreadable time: never counted
];

describe("bucketOf", () => {
  it("only an exact COMPLETED state is a sale", () => {
    expect(bucketOf(" completed ")).toBe("completed");
    expect(bucketOf("Cancelled")).toBe("cancelled");
    expect(bucketOf("REJECTED")).toBe("rejected");
    expect(bucketOf("READY_FOR_PICKUP")).toBe("open");
    expect(bucketOf("IN_TRANSIT")).toBe("open");
    expect(bucketOf(undefined)).toBe("open");
    expect(bucketOf(42)).toBe("open");
  });
});

describe("buildReport KPIs (TC1, TC2, TC3)", () => {
  it("TC1: only completed orders count as money; every status counts as an order", () => {
    const k = buildReport(ORDERS, WEEK, 10, NOW).kpis;
    expect(k).toEqual({
      orders: 6,
      completed: 3,
      cancelled: 1,
      rejected: 1,
      open: 1,
      gross: 244.65,
      commission: 24.47, // 11 + 8.91 + 4.56, each order rounded on its own
      net: 220.18,
      aov: 81.55,
      itemsSold: 4,
      lostValue: 339,
      customers: 2,
      completionRate: 0.5,
      cancelRate: 1 / 6,
      rejectRate: 1 / 6,
    });
  });

  it("TC2: the commission rate changes commission and net only", () => {
    const k = buildReport(ORDERS, WEEK, 5, NOW).kpis;
    expect([k.gross, k.commission, k.net]).toEqual([244.65, 12.24, 232.41]);
  });

  it("TC3: compares with the same days of last week; a Friday order is in neither", () => {
    const r = buildReport(ORDERS, WEEK, 10, NOW);
    expect(r.previous).toEqual({ start: new Date(2026, 8, 28), end: new Date(2026, 9, 1, 15) });
    expect(r.previousKpis.gross).toBe(200);
    expect(r.previousKpis.orders).toBe(1);
  });

  it("TC9: lists the period's orders newest first, without the unreadable one", () => {
    expect(buildReport(ORDERS, WEEK, 10, NOW).orders.map((o) => o.orderId)).toEqual(["E", "D", "F", "C", "B", "A"]);
  });
});

describe("series, heatmap, payments, timing (TC4, TC5)", () => {
  it("TC4: a week gives seven daily points, empty days included", () => {
    const { grain, points } = buildReport(ORDERS, WEEK, 10, NOW).series;
    expect(grain).toBe("day");
    expect(points.map((p) => [p.label, p.orders, p.completed, p.gross, p.net])).toEqual([
      ["Mon 5 Oct", 1, 1, 110, 99],
      ["Tue 6 Oct", 2, 1, 89.1, 80.19],
      ["Wed 7 Oct", 2, 1, 45.55, 40.99],
      ["Thu 8 Oct", 1, 0, 0, 0],
      ["Fri 9 Oct", 0, 0, 0, 0],
      ["Sat 10 Oct", 0, 0, 0, 0],
      ["Sun 11 Oct", 0, 0, 0, 0],
    ]);
  });

  it("TC4: a year gives twelve monthly points", () => {
    const { grain, points } = buildReport(ORDERS, presetRange("THIS_YEAR", NOW), 10, NOW).series;
    expect(grain).toBe("month");
    expect(points).toHaveLength(12);
    expect(points[8]).toMatchObject({ key: "2026-09", label: "Sep 2026", completed: 1, gross: 200 });
    expect(points[9]).toMatchObject({ key: "2026-10", label: "Oct 2026", completed: 4, gross: 1244.65 });
  });

  it("TC5: heatmap counts every order by weekday and hour", () => {
    const { cells, max } = buildReport(ORDERS, WEEK, 10, NOW).heatmap;
    expect(cells[0][10]).toBe(1); // Mon 10 AM
    expect(cells[1][19]).toBe(1); // Tue 7 PM
    expect(cells[2][19]).toBe(1); // Wed 7 PM
    expect(cells.flat().reduce((s, n) => s + n, 0)).toBe(6);
    expect(max).toBe(1);
  });

  it("TC5: payment mix groups completed orders by method", () => {
    expect(buildReport(ORDERS, WEEK, 10, NOW).payments).toEqual([
      { method: "COD", orders: 2, gross: 155.55 },
      { method: "PREPAID", orders: 1, gross: 89.1 },
    ]);
  });

  it("TC5: timing uses medians and ignores impossible negative gaps", () => {
    expect(buildReport(ORDERS, WEEK, 10, NOW).timing).toEqual({ medianAcceptMin: 3, medianPrepMin: 17 });
  });
});

describe("settlementWeeks (TC6)", () => {
  it("shows the running week, then earlier weeks with their payout status", () => {
    const weeks = settlementWeeks(ORDERS, 10, NOW, 3);
    expect(weeks.map((w) => [w.range.start, w.payoutDate, w.status, w.completed, w.gross, w.commission, w.net, w.settledOrders])).toEqual([
      [new Date(2026, 9, 5), new Date(2026, 9, 12), "in_progress", 3, 244.65, 24.47, 220.18, 0],
      [new Date(2026, 8, 28), new Date(2026, 9, 5), "pending", 2, 1200, 120, 1080, 1],
      [new Date(2026, 8, 21), new Date(2026, 8, 28), "empty", 0, 0, 0, 0, 0],
    ]);
  });

  it("marks a finished week settled when every completed order is settled", () => {
    const paid = [order("S1", "COMPLETED", "2026-09-29 12:00:00", 100, { isSettled: true })];
    expect(settlementWeeks(paid, 10, NOW, 2)[1].status).toBe("settled");
  });

  it("defaults to the current week plus seven before it", () => {
    expect(settlementWeeks([], 10, NOW)).toHaveLength(8);
  });
});

describe("insights (TC7)", () => {
  it("writes the fixture's insights in a fixed order", () => {
    expect(buildReport(ORDERS, WEEK, 10, NOW).insights).toEqual([
      { tone: "good", text: "Sales up 22.3% vs the previous period (₹244.65 vs ₹200)." },
      { tone: "good", text: "Best seller: Chicken Shawarma Combo — 1 sold, 70.7% of item sales." },
      { tone: "warn", text: "2 orders were cancelled or rejected (33.3% of orders) — ₹339 in lost sales." },
    ]);
  });

  it("names the busiest slot once it has 2+ orders", () => {
    const busy = [
      order("P1", "COMPLETED", "2026-10-06 19:05:00", 100),
      order("P2", "COMPLETED", "2026-10-06 19:40:00", 100),
    ];
    const texts = buildReport(busy, WEEK, 10, NOW).insights.map((i) => i.text);
    expect(texts).toContain("Busiest time: Tuesday 7 PM–8 PM (2 orders). Keep the kitchen ready then.");
  });

  it("flags slow acceptance and at-risk customers", () => {
    const slow = [
      order("Q1", "COMPLETED", "2026-10-06 19:00:00", 100, { customerId: 7, acceptedDate: "2026-10-06 19:09:00" }),
      order("Q2", "COMPLETED", "2026-08-25 19:00:00", 100, { customerId: 8 }),
      order("Q3", "COMPLETED", "2026-09-01 19:00:00", 100, { customerId: 8 }),
    ];
    const texts = buildReport(slow, WEEK, 10, NOW).insights.map((i) => i.text);
    expect(texts).toContain("1 customer hasn't ordered in 30–60 days — a small offer can win them back.");
    expect(texts).toContain("Orders wait a median 9 min to be accepted — faster acceptance cuts cancellations.");
  });
});

describe("empty period (TC8)", () => {
  it("gives zeros and a single message, never NaN", () => {
    const r = buildReport([], WEEK, 10, NOW);
    for (const v of Object.values(r.kpis)) expect(Number.isFinite(v)).toBe(true);
    expect(r.kpis.aov).toBe(0);
    expect(r.series.points).toHaveLength(7);
    expect(r.series.points.every((p) => p.gross === 0 && p.orders === 0)).toBe(true);
    expect(r.insights).toEqual([{ tone: "info", text: "No orders in this period." }]);
    expect(r.items).toEqual([]);
    expect(r.timing).toEqual({ medianAcceptMin: null, medianPrepMin: null });
    expect(r.heatmap.max).toBe(0);
  });
});

describe("allTimeRange (TC9)", () => {
  it("runs from the first order's day to the end of today", () => {
    expect(allTimeRange(ORDERS, NOW)).toEqual({ start: new Date(2026, 8, 29), end: new Date(2026, 9, 9) });
    expect(allTimeRange([], NOW)).toEqual({ start: new Date(2026, 9, 8), end: new Date(2026, 9, 9) });
  });
});
