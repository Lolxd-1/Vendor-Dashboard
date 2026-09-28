import { describe, it, expect } from "vitest";
import { buildCounterBill, buildKitchenKOT, paymentLabel } from "../billTemplates";
import { BIG, COLS, center, row } from "../receiptFormat";
import type { Order, OrderItem } from "../../../types/order";

const baseOrder: Order = {
  orderId: "QV-2026-181859",
  campusId: "CAMPUS-1",
  shopId: 1,
  customerId: 1001,

  customerName: "Rahul Sharma",
  customerMobile: 9876543210,
  customerAddress: "Hostel Block A, Near Gate 2",

  state: "PLACED",
  creationTime: "2026-09-20 12:30:00",
  preparationTime: 15,

  orderItem: [
    { id: 1, name: "Veg Burger", itemCount: 2, itemPrice: 120 },
    { id: 2, name: "Cold Coffee", itemCount: 1, itemPrice: 80 },
  ],
  totalItemCount: 3,
  productCount: 2,
  totalAmount: 320,
  invoiceAmount: 320,
  amountExcludingDeliveryFee: 320,
  deliveryFee: 0,

  fulfillmentOption: "Delivery",
  productImageURLs: "",
  stateLabel: "Placed",
  orderDescription: "",
  orderLink: "",
  paymentMethod: "Online",
  isSettled: true,

  shopDetails: null,
};

const makeOrder = (overrides: Partial<Order> = {}): Order => ({ ...baseOrder, ...overrides });

describe("billTemplates payment status", () => {
  it("TC9 (THE BUG): COD, not settled -> KOT has no 'paid' in any casing and no payment line", () => {
    const order = makeOrder({ isSettled: false, paymentMethod: "COD" });
    const kot = buildKitchenKOT(order);
    expect(kot).not.toMatch(/paid/i);
    expect(kot).not.toMatch(/COLLECT|\bCOD\b/);
  });

  it("TC10 (AC7): COD, not settled -> the bill never says 'paid'; COD once at the top, no COLLECT / Pay by", () => {
    const order = makeOrder({ isSettled: false, paymentMethod: "COD" });
    const bill = buildCounterBill(order);

    // Enumerating every occurrence, rather than excluding known ones, is what makes
    // this assertion hold against a line that has not been written yet.
    const paidLines = bill.split("\n").filter((l) => /paid/i.test(l)).map((l) => l.trim());
    expect(paidLines).toEqual([]);

    expect(bill.split("\n").filter((l) => /\bCOD\b/.test(l)).map((l) => l.trim())).toEqual(["COD"]);
    expect(bill).not.toContain("COLLECT");
    expect(bill).not.toContain("Pay by");
  });

  it("TC11: COD is decided by method, even when settled", () => {
    const order = makeOrder({ isSettled: true, paymentMethod: "COD" });
    const bill = buildCounterBill(order);
    expect(paymentLabel(order)).toEqual({ headline: "COD", collect: 320 });
    expect(bill.split("\n").map((l) => l.trim())).toContain("COD");
    expect(bill).not.toMatch(/prepaid/i);
  });

  it("TC12: Online -> PREPAID at the top of the bill, no Paid via line; KOT has no payment line", () => {
    const order = makeOrder({ isSettled: false, paymentMethod: "Online" });
    expect(paymentLabel(order)).toEqual({ headline: "PREPAID", collect: null });

    const bill = buildCounterBill(order);
    const kot = buildKitchenKOT(order);
    expect(bill.split("\n").map((l) => l.trim())).toContain("PREPAID");
    expect(bill).not.toContain("Paid via");
    expect(kot).not.toMatch(/PREPAID|COLLECT/);
  });

  it('TC13: not settled, empty paymentMethod -> "PAYMENT: UNCONFIRMED"', () => {
    const order = makeOrder({ isSettled: false, paymentMethod: "" });
    expect(paymentLabel(order)).toEqual({ headline: "PAYMENT: UNCONFIRMED", collect: null });
  });

  it("TC14 (width): 45 long-name items -> every line of both slips is <= COLS chars", () => {
    const items: OrderItem[] = Array.from({ length: 45 }, (_, i) => ({
      id: i + 1,
      name: `Deluxe Combo Meal Extra Large ${i + 1}`,
      itemCount: 1 + (i % 3),
      itemPrice: 99.5,
    }));
    const order = makeOrder({ isSettled: false, paymentMethod: "COD", orderItem: items });

    const bill = buildCounterBill(order);
    const kot = buildKitchenKOT(order);
    bill.split("\n").forEach((l) => expect(l.length).toBeLessThanOrEqual(COLS));
    kot.split("\n").forEach((l) => expect(l.length).toBeLessThanOrEqual(COLS));
  });

  it("TC15 (robustness): empty items, missing name/shop, null invoiceAmount -> no throw", () => {
    const order = makeOrder({
      orderItem: [],
      customerName: undefined,
      shopDetails: undefined,
      // Real API responses have sent null here despite the `number` type; simulate that.
      invoiceAmount: null as unknown as number,
    });
    expect(() => buildCounterBill(order)).not.toThrow();
    expect(() => buildKitchenKOT(order)).not.toThrow();
  });

  it("TC16: the real Order ID appears in full on both slips", () => {
    const order = makeOrder({ orderId: "QV-2026-181859" });
    const bill = buildCounterBill(order);
    const kot = buildKitchenKOT(order);
    expect(bill).toContain("QV-2026-181859");
    expect(kot).toContain("QV-2026-181859");
  });
});

describe("billTemplates layout", () => {
  const cod = () => makeOrder({ isSettled: false, paymentMethod: "COD", orderId: "2834936361926645" });

  it("bill opens with a big, centred QuickVerse heading, then the shop name", () => {
    const lines = buildCounterBill(cod()).split("\n");
    expect(lines[0]).toBe(BIG + center("QuickVerse"));
    expect(lines[1].trim()).toBe("Your Store");
  });

  it("bill: Total Qty + Sub Total, then Grand Total, then straight to the OTP block", () => {
    const lines = buildCounterBill(cod()).split("\n");
    const i = lines.findIndex((l) => l.startsWith("Total Qty"));
    expect(lines[i]).toBe(row("Total Qty: 3", "Sub Total   320.00"));
    expect(lines[i + 1]).toBe(row("Grand Total", "Rs 320.00"));
    expect(lines[i + 2]).toBe("-".repeat(COLS));
    expect(lines[i + 3].trim()).toBe("OTP: 6645");
  });

  it("DELIVERY from the backend prints as Delivery on both slips", () => {
    const order = makeOrder({ fulfillmentOption: "DELIVERY" });
    expect(buildCounterBill(order)).toMatch(/Delivery$/m);
    expect(buildKitchenKOT(order)).toContain("Delivery");
    expect(buildCounterBill(order)).not.toContain("DELIVERY");
  });

  it("bill has no customer name/phone, no CGST/SGST, no ECO tax note", () => {
    const bill = buildCounterBill(cod());
    expect(bill).not.toContain("Rahul Sharma");
    expect(bill).not.toContain("9876543210");
    expect(bill).not.toMatch(/CGST|SGST/);
    expect(bill).not.toMatch(/9\(5\)|ECO/);
  });

  it("bill keeps Bill No., date/time and prep time", () => {
    const bill = buildCounterBill(cod(), 15);
    expect(bill).toContain("Bill No.: 926645");
    expect(bill).toContain("Date: 20/09/26, 12:30 PM");
    expect(buildCounterBill(makeOrder({ creationTime: "2026-09-20 20:57:00" }))).toContain("Date: 20/09/26, 8:57 PM");
    expect(bill).toContain("Prep Time: 15 min");
  });

  it("bill shows the last 4 digits of the Order ID as the rider OTP", () => {
    const lines = buildCounterBill(cod()).split("\n").map((l) => l.trim());
    expect(lines).toContain("OTP: 6645");
    expect(lines[lines.indexOf("OTP: 6645") + 1]).toBe("Show this to rider");
    expect(lines).not.toContain("Order ID: 2834936361926645");
  });

  it("KOT: no COLLECT line, no customer name; Total Qty + Sub Total at the bottom", () => {
    const kot = buildKitchenKOT(cod());
    expect(kot).not.toContain("COLLECT");
    expect(kot).not.toContain("Rahul Sharma");
    expect(kot).not.toContain("Customer");
    expect(kot.split("\n")).toContain(row("Total Qty: 3", "Sub Total   320.00"));
  });

  it("an item with no itemPrice takes its amount from the sub total when it is the only one missing", () => {
    const single = makeOrder({ amountExcludingDeliveryFee: 197, orderItem: [{ id: 1, name: "Kadam Fresh Paneer 500g", itemCount: 1 }] });
    for (const slip of [buildCounterBill(single), buildKitchenKOT(single)]) {
      expect(slip.split("\n")).toContain("Kadam Fresh".padEnd(15) + "   1  197.00   197.00");
    }
    const mixed = makeOrder({ amountExcludingDeliveryFee: 320, orderItem: [
      { id: 1, name: "Veg Burger", itemCount: 2, itemPrice: 120 },
      { id: 2, name: "Cold Coffee", itemCount: 2 },
    ] });
    expect(buildCounterBill(mixed).split("\n")).toContain("Cold Coffee".padEnd(15) + "   2   40.00    80.00");
  });

  it("two items with no itemPrice cannot be split honestly -> both stay --", () => {
    const order = makeOrder({ orderItem: [{ id: 1, name: "Tea", itemCount: 1 }, { id: 2, name: "Bun", itemCount: 1 }] });
    const lines = buildCounterBill(order).split("\n");
    expect(lines).toContain("Tea".padEnd(15) + "   1      --       --");
    expect(lines).toContain("Bun".padEnd(15) + "   1      --       --");
  });

  it("item table: Qty/Price/Amount columns end at the same column on every row, both slips", () => {
    const order = makeOrder({
      orderItem: [
        { id: 1, name: "Paneer Tikka Biryani Special", itemCount: 12, itemPrice: 250 },
        { id: 2, name: "Tea", itemCount: 1, itemPrice: 10 },
      ],
    });
    for (const slip of [buildCounterBill(order), buildKitchenKOT(order)]) {
      const lines = slip.split("\n");
      const header = lines.find((l) => l.startsWith("Item"))!;
      const biryani = lines.find((l) => l.startsWith("Paneer Tikka"))!;
      const tea = lines.find((l) => l.startsWith("Tea"))!;
      expect(header).toBe("Item           Qty.   Price   Amount");
      expect(biryani).toBe("Paneer Tikka".padEnd(15) + "  12  250.00  3000.00");
      expect(tea).toBe("Tea".padEnd(15) + "   1   10.00    10.00");
      // wrapped remainder of the name sits on its own line under the Item column
      expect(lines[lines.indexOf(biryani) + 1]).toBe("Biryani");
      expect(lines[lines.indexOf(biryani) + 2]).toBe("Special");
    }
  });
});
