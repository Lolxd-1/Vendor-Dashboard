import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../../types/order";

const { printMock, toastMock } = vi.hoisted(() => {
  const toastMock = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { printMock: vi.fn(), toastMock };
});
vi.mock("../printAgent", () => ({ printTextDetailed: printMock }));
vi.mock("react-hot-toast", () => ({ default: toastMock }));

import {
  buildItemsSummary,
  printItemsSummary,
  slipLineCount,
  CONFIRM_ABOVE_LINES,
  MAX_SLIP_LINES,
} from "../itemsSummary";
import { BIG, COLS } from "../receiptFormat";

// Same column layout as the counter bill: 15 name + 4 qty + 8 price + 9 amount.
const cols = (name: string, qty: string, price: string, amount: string) =>
  name.padEnd(15) + qty.padStart(4) + price.padStart(8) + amount.padStart(9);

const item = (name: string, itemCount: number, itemPrice?: number) => ({ id: 0, name, itemCount, itemPrice });

const order = (over: Partial<Order>): Order =>
  ({
    orderId: "ORD-1",
    creationTime: "2026-10-02 12:00:00",
    state: "COMPLETED",
    orderItem: [],
    amountExcludingDeliveryFee: 0,
    totalAmount: 0,
    invoiceAmount: 0,
    shopDetails: { name: "Tuljai Biryani" },
    ...over,
  }) as unknown as Order;

// The API returns newest first; the slip must still read oldest → newest.
const ORDERS = [
  order({
    orderId: "ORD-3", creationTime: "2026-10-02 14:00:00",
    orderItem: [item("Chicken Tikka Masala", 3, 150), item("Biryani", 1, 180)],
    amountExcludingDeliveryFee: 630, invoiceAmount: 660,
  }),
  order({
    orderId: "ORD-2", creationTime: "2026-10-02 13:00:00",
    orderItem: [item("Shawarma", 2, 90)],
    amountExcludingDeliveryFee: 180, invoiceAmount: 190,
  }),
  order({
    orderId: "ORD-1", creationTime: "2026-10-02 12:00:00",
    orderItem: [item("Biryani", 1, 180), item("Shawarma", 2, 90)],
    amountExcludingDeliveryFee: 360, invoiceAmount: 380,
  }),
];

const NOW = new Date(2026, 9, 3, 10, 30);
const build = (orders: Order[], filters = {}) => buildItemsSummary(orders, filters, NOW).split("\n");

describe("buildItemsSummary", () => {
  it("merges every item into one list, in the order first sold (oldest order first)", () => {
    const L = build(ORDERS);
    const start = L.indexOf(cols("Item", "Qty.", "Price", "Amount"));
    expect(start).toBeGreaterThan(-1);
    expect(L.slice(start + 2, start + 7)).toEqual([
      cols("Biryani", "2", "180.00", "360.00"),
      cols("Shawarma", "4", "90.00", "360.00"),
      cols("Chicken Tikka", "3", "150.00", "450.00"),
      "Masala",
      "-".repeat(COLS),
    ]);
  });

  it("totals: quantity, sub total (vendor amount) and grand total like the bill", () => {
    const L = build(ORDERS);
    expect(L).toContain("Total Qty: 9".padEnd(COLS - 18) + "Sub Total" + "1170.00".padStart(9));
    expect(L).toContain("Grand Total" + "Rs 1230.00".padStart(COLS - 11));
  });

  it("heading shows shop, filter, oldest→newest range and order count", () => {
    const L = build(ORDERS, { status: "COMPLETED", timeRange: "TODAY" });
    expect(L[0].startsWith(BIG)).toBe(true);
    expect(L[0]).toContain("QuickVerse");
    expect(L[1].trim()).toBe("Tuljai Biryani");
    expect(L).toContain(" ".repeat(11) + "ITEMS SUMMARY");
    expect(L).toContain("Status: Completed");
    expect(L).toContain("Period: Today");
    expect(L).toContain("From: 02/10/26, 12:00 PM");
    expect(L).toContain("To:   02/10/26, 2:00 PM");
    expect(L).toContain("Orders: 3");
    expect(L).toContain("Printed: 03/10/26, 10:30 AM");
  });

  it.each([
    [{ status: "REJECTED", timeRange: "LAST_WEEK" }, "Status: Rejected", "Period: Last Week"],
    [{ status: "READY_FOR_PICKUP" }, "Status: Ready for pickup", "Period: All time"],
    [{}, "Status: All", "Period: All time"],
    [{ timeRange: "THIS_MONTH" }, "Status: All", "Period: Monthly"],
    [
      { timeRange: "CUSTOM", from: new Date(2026, 8, 1), to: new Date(2026, 8, 30) },
      "Status: All",
      "Period: 01/09/26 - 30/09/26",
    ],
  ])("labels the filter %j", (filters, status, period) => {
    const L = build(ORDERS, filters);
    expect(L).toContain(status);
    expect(L).toContain(period);
  });

  it("prints whatever the filter returned — rejected orders included", () => {
    const L = build([order({ state: "REJECTED", orderItem: [item("Biryani", 5, 180)], amountExcludingDeliveryFee: 900 })], {
      status: "REJECTED",
    });
    expect(L).toContain(cols("Biryani", "5", "180.00", "900.00"));
    expect(L).toContain("Status: Rejected");
  });

  it("same dish at two prices stays on two lines so the money adds up", () => {
    const L = build([
      order({ creationTime: "2026-10-01 12:00:00", orderItem: [item("Biryani", 1, 160)], amountExcludingDeliveryFee: 160 }),
      order({ creationTime: "2026-10-02 12:00:00", orderItem: [item("Biryani", 2, 180)], amountExcludingDeliveryFee: 360 }),
    ]);
    expect(L).toContain(cols("Biryani", "1", "160.00", "160.00"));
    expect(L).toContain(cols("Biryani", "2", "180.00", "360.00"));
  });

  it("merges names that differ only in case or spaces", () => {
    const L = build([
      order({ creationTime: "2026-10-01 12:00:00", orderItem: [item("Veg Biryani ", 1, 120)], amountExcludingDeliveryFee: 120 }),
      order({ creationTime: "2026-10-02 12:00:00", orderItem: [item("veg biryani", 2, 120)], amountExcludingDeliveryFee: 240 }),
    ]);
    expect(L).toContain(cols("Veg Biryani", "3", "120.00", "360.00"));
    expect(L.filter((l) => /^veg biryani/i.test(l))).toHaveLength(1);
  });

  it("uses the bill's price rule: one missing price is filled from that order's sub total", () => {
    const L = build([order({ orderItem: [item("Thali", 2)], amountExcludingDeliveryFee: 300 })]);
    expect(L).toContain(cols("Thali", "2", "150.00", "300.00"));
  });

  it("two missing prices in one order stay '--' (never guessed)", () => {
    const L = build([order({ orderItem: [item("Tea", 1), item("Coffee", 1)], amountExcludingDeliveryFee: 50 })]);
    expect(L).toContain(cols("Tea", "1", "--", "--"));
    expect(L).toContain(cols("Coffee", "1", "--", "--"));
  });

  it("an unpriced line is not merged with a priced line of the same dish", () => {
    const L = build([
      order({ creationTime: "2026-10-01 12:00:00", orderItem: [item("Tea", 1), item("Coffee", 1)], amountExcludingDeliveryFee: 50 }),
      order({ creationTime: "2026-10-02 12:00:00", orderItem: [item("Tea", 2, 20)], amountExcludingDeliveryFee: 40 }),
    ]);
    expect(L).toContain(cols("Tea", "1", "--", "--"));
    expect(L).toContain(cols("Tea", "2", "20.00", "40.00"));
  });

  it("orders without a readable time go last, keeping their order", () => {
    const L = build([
      order({ creationTime: "garbage", orderItem: [item("Late", 1, 10)], amountExcludingDeliveryFee: 10 }),
      order({ creationTime: "2026-10-02 12:00:00", orderItem: [item("Early", 1, 10)], amountExcludingDeliveryFee: 10 }),
    ]);
    expect(L.findIndex((l) => l.startsWith("Early"))).toBeLessThan(L.findIndex((l) => l.startsWith("Late")));
  });

  it("never prints a line wider than the 36-column slip", () => {
    const long = order({
      orderItem: [item("Extra Large Special Hyderabadi Dum Biryani Family Pack", 12, 1499.5)],
      amountExcludingDeliveryFee: 17994,
    });
    build([long, ...ORDERS], { status: "COMPLETED", timeRange: "CUSTOM", from: new Date(2026, 0, 1), to: new Date(2026, 9, 2) })
      .filter((l) => !l.startsWith(BIG))
      .forEach((l) => expect(l.length).toBeLessThanOrEqual(COLS));
  });

  it("orders with no items or missing fields do not crash or print 'undefined'", () => {
    const text = buildItemsSummary(
      [order({ orderItem: undefined as unknown as Order["orderItem"], amountExcludingDeliveryFee: undefined as unknown as number })],
      {},
      NOW,
    );
    expect(text).not.toMatch(/undefined|NaN|null/);
    expect(text).toContain("Total Qty: 0");
  });
});

describe("printItemsSummary", () => {
  beforeEach(() => {
    printMock.mockReset();
    toastMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("sends ONE job to the counter printer, like a bill", async () => {
    printMock.mockResolvedValue({ where: "agent", printer: "EPSON TM-T82X Receipt" });
    await printItemsSummary(ORDERS, { status: "COMPLETED" });
    expect(printMock).toHaveBeenCalledTimes(1);
    expect(printMock.mock.calls[0][0]).toBe("counter");
    expect(printMock.mock.calls[0][1]).toContain("ITEMS SUMMARY");
    expect(toastMock.success).toHaveBeenCalledWith("Items summary sent → EPSON TM-T82X Receipt");
  });

  it("says when the browser print window opened instead", async () => {
    printMock.mockResolvedValue({ where: "browser", printer: "EPSON" });
    await printItemsSummary(ORDERS, {});
    expect(toastMock).toHaveBeenCalledWith("Print window opened — confirm to print", expect.anything());
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("shows the real reason when printing failed — never a fake success", async () => {
    printMock.mockResolvedValue({ where: "failed", printer: "EPSON", error: "Printer not found: EPSON" });
    await printItemsSummary(ORDERS, {});
    expect(toastMock.error).toHaveBeenCalledWith("Print failed: EPSON: Printer not found: EPSON", { duration: 6000 });
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("an unexpected error becomes an error toast, not a crash", async () => {
    printMock.mockRejectedValue(new Error("boom"));
    await expect(printItemsSummary(ORDERS, {})).resolves.toBeUndefined();
    expect(toastMock.error).toHaveBeenCalledWith("Print failed: boom", { duration: 6000 });
  });
});

// An order with `n` different one-line items -> a slip of about n + 20 lines.
const manyItems = (n: number) =>
  order({
    orderItem: Array.from({ length: n }, (_, i) => item(`Item ${i}`, 1, 10)),
    amountExcludingDeliveryFee: n * 10,
  });

describe("slipLineCount", () => {
  it("counts the double-height heading as two lines, like the print agent", () => {
    expect(slipLineCount(`${BIG}QuickVerse
Shop
----`)).toBe(4);
    expect(slipLineCount(`a
b`)).toBe(2);
  });
});

describe("printItemsSummary — long slips", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    printMock.mockReset();
    printMock.mockResolvedValue({ where: "agent", printer: "EPSON" });
    toastMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    confirmSpy = vi.spyOn(window, "confirm");
  });
  afterEach(() => confirmSpy.mockRestore());

  it("a normal slip prints without asking", async () => {
    await printItemsSummary(ORDERS, {});
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it("a long slip asks first, showing lines and paper length, and prints on OK", async () => {
    confirmSpy.mockReturnValue(true);
    const orders = [manyItems(CONFIRM_ABOVE_LINES)];
    const lines = slipLineCount(buildItemsSummary(orders, {}));
    await printItemsSummary(orders, {});
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const msg = confirmSpy.mock.calls[0][0] as string;
    expect(msg).toContain(`${lines} lines`);
    expect(msg).toContain(`about ${((lines * 4) / 1000).toFixed(1)} m of paper`);
    expect(msg).toContain("(1 orders)");
    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it("Cancel prints nothing", async () => {
    confirmSpy.mockReturnValue(false);
    await printItemsSummary([manyItems(CONFIRM_ABOVE_LINES)], {});
    expect(printMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith("Not printed");
  });

  it("exactly at the confirm limit it does not ask; one line more it does", async () => {
    // find an item count whose slip is exactly CONFIRM_ABOVE_LINES lines
    let n = CONFIRM_ABOVE_LINES;
    while (slipLineCount(buildItemsSummary([manyItems(n)], {})) > CONFIRM_ABOVE_LINES) n--;
    expect(slipLineCount(buildItemsSummary([manyItems(n)], {}))).toBe(CONFIRM_ABOVE_LINES);
    await printItemsSummary([manyItems(n)], {});
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockReturnValue(true);
    await printItemsSummary([manyItems(n + 1)], {});
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it("a slip over the hard limit is refused before anything is sent — no question, no print", async () => {
    await printItemsSummary([manyItems(MAX_SLIP_LINES)], {});
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(printMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/too long to print in one go.*shorter period.*Export/), { duration: 8000 });
  });

  it("the real 386-order week (1,159 lines) is allowed after confirming", () => {
    expect(1159).toBeGreaterThan(CONFIRM_ABOVE_LINES);
    expect(1159).toBeLessThanOrEqual(MAX_SLIP_LINES);
  });

  it.each([
    "print failed: print timed out - check the printer before reprinting", // agent gave up waiting on the spooler
    "printer did not answer in time — CHECK THE PRINTER before using Reprint", // dashboard gave up waiting on the agent
  ])("a timeout says the slip may still be printing, never 'failed': %s", async (error) => {
    printMock.mockResolvedValue({ where: "failed", printer: "EPSON", error });
    await printItemsSummary(ORDERS, {});
    expect(toastMock.error).toHaveBeenCalledWith(
      "The slip may still be printing on EPSON — check the printer before printing again.",
      { duration: 10000 }
    );
  });

  it("a printer-lookup timeout (nothing was sent) stays a plain failure", async () => {
    printMock.mockResolvedValue({ where: "failed", printer: "EPSON", error: "print failed: printer lookup timed out" });
    await printItemsSummary(ORDERS, {});
    expect(toastMock.error).toHaveBeenCalledWith("Print failed: EPSON: print failed: printer lookup timed out", { duration: 6000 });
  });
});
