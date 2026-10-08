import { describe, expect, it } from "vitest";
import type { Order } from "../../../types/order";
import { cohortRetention, customerKey, customerStats } from "../customers";
import { settlementWeekOf } from "../period";

const order = (customerId: number | undefined, creationTime: string, gross: number, extra: Partial<Order> = {}) =>
  ({
    orderId: `${customerId}-${creationTime}`,
    state: "COMPLETED",
    customerId,
    customerName: `Customer ${customerId}`,
    customerMobile: undefined,
    creationTime,
    amountExcludingDeliveryFee: gross,
    orderItem: [],
    ...extra,
  }) as unknown as Order;

const NOW = new Date(2026, 9, 8, 15); // Thu 8 Oct 2026, 3 PM
const WEEK = settlementWeekOf(NOW); // Mon 5 Oct → Mon 12 Oct

const ORDERS = [
  order(1, "2026-09-01 12:00:00", 100, { customerName: "Suhail", customerMobile: 918126633411 }),
  order(1, "2026-10-06 13:00:00", 200, { customerName: "Suhail", customerMobile: 918126633411 }),
  order(1, "2026-10-07 20:00:00", 150, { customerName: "Suhail", customerMobile: 918126633411 }),
  order(2, "2026-10-06 19:00:00", 300),
  order(3, "2026-08-01 12:00:00", 50),
  order(5, "2026-08-20 12:00:00", 60),
  order(5, "2026-09-01 12:00:00", 60),
  order(6, "2026-09-25 12:00:00", 70),
  order(6, "2026-10-01 12:00:00", 70),
  order(undefined, "2026-10-07 10:00:00", 80, { customerMobile: 919999900001, customerName: "" }),
  order(0, "2026-10-07 11:00:00", 999, { customerName: "" }), // no identity at all: skipped
  order(7, "not a date", 999), // unreadable time: skipped
];

describe("customerKey", () => {
  it("prefers customer id, then phone, then name", () => {
    expect(customerKey(order(42, "", 0))).toBe("id:42");
    expect(customerKey(order(undefined, "", 0, { customerMobile: 919876543210 }))).toBe("ph:9876543210");
    expect(customerKey(order(0, "", 0, { customerName: " Ravi " }))).toBe("nm:ravi");
    expect(customerKey(order(0, "", 0, { customerName: "" }))).toBe("");
  });
});

describe("customerStats (TC7, TC8)", () => {
  it("splits the week's customers into new and returning by their first-ever order", () => {
    const s = customerStats(ORDERS, WEEK, NOW);
    expect(s.unique).toBe(3); // Suhail, #2, the phone-only customer
    expect(s.newCount).toBe(2);
    expect(s.returningCount).toBe(1);
    expect(s.repeatCount).toBe(1);
    expect(s.repeatRate).toBeCloseTo(1 / 3);
    expect(s.newSales).toBe(380);
    expect(s.returningSales).toBe(350);
  });

  it("ranks top customers by spend with a masked phone", () => {
    const top = customerStats(ORDERS, WEEK, NOW).top;
    expect(top.map((r) => [r.name, r.orders, r.spend, r.isNew])).toEqual([
      ["Suhail", 2, 350, false],
      ["Customer 2", 1, 300, true],
      ["", 1, 80, true],
    ]);
    expect(top[0].phoneTail).toBe("3411");
    expect(top[0].lastOrder).toEqual(new Date(2026, 9, 7, 20));
  });

  it("segments every customer as of now for a running week", () => {
    expect(customerStats(ORDERS, WEEK, NOW).segments).toEqual({
      champions: 1, // Suhail: 3 orders, last yesterday
      repeat: 1, // #6: 2 orders, last 7 days ago
      new: 2, // #2 and the phone-only customer
      atRisk: 1, // #5: last order 37 days ago
      lapsed: 1, // #3: last order 68 days ago
    });
  });

  it("segments as of the end of a finished period", () => {
    const lastWeek = settlementWeekOf(new Date(2026, 8, 30)); // 28 Sep → 5 Oct
    expect(customerStats(ORDERS, lastWeek, NOW).segments).toEqual({
      champions: 0,
      repeat: 1, // #6
      new: 0,
      atRisk: 2, // Suhail (only the 1 Sep order by then) and #5
      lapsed: 1, // #3
    });
  });

  it("TC10: no orders gives zeros, not NaN", () => {
    const s = customerStats([], WEEK, NOW);
    expect(s).toEqual({
      unique: 0,
      newCount: 0,
      returningCount: 0,
      repeatCount: 0,
      newSales: 0,
      returningSales: 0,
      repeatRate: 0,
      top: [],
      segments: { champions: 0, repeat: 0, new: 0, atRisk: 0, lapsed: 0 },
    });
  });
});

describe("cohortRetention (TC9)", () => {
  it("groups customers by first-order month and tracks who came back each later month", () => {
    expect(cohortRetention(ORDERS, NOW)).toEqual([
      { month: "2026-08", label: "Aug 2026", size: 2, retained: [0.5, 0] }, // #3, #5 → #5 back in Sep
      { month: "2026-09", label: "Sep 2026", size: 2, retained: [1] }, // Suhail, #6 → both back in Oct
      { month: "2026-10", label: "Oct 2026", size: 2, retained: [] }, // #2, phone-only
    ]);
  });

  it("keeps only the most recent cohorts", () => {
    expect(cohortRetention(ORDERS, NOW, 2).map((c) => c.month)).toEqual(["2026-09", "2026-10"]);
  });

  it("TC10: no orders gives no cohorts", () => {
    expect(cohortRetention([], NOW)).toEqual([]);
  });
});
