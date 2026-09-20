import { describe, it, expect } from "vitest";
import { buildCounterBill, buildKitchenKOT, paymentLabel } from "../billTemplates";
import { COLS } from "../receiptFormat";
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

// "Standalone token" check: PAID must not appear as its own word (avoids false
// positives/negatives from substrings like the unconditional "Paid via <method>" line).
const hasStandaloneToken = (text: string, token: string) => text.split(/\s+/).includes(token);

describe("billTemplates payment status", () => {
  it("TC9 (THE BUG): COD, not settled -> KOT has no PAID and has COLLECT", () => {
    const order = makeOrder({ isSettled: false, paymentMethod: "COD" });
    const kot = buildKitchenKOT(order);
    expect(kot).not.toContain("PAID");
    expect(kot).toContain("COLLECT");
  });

  it("TC10: COD, not settled -> counter bill has no standalone PAID token and has COLLECT", () => {
    const order = makeOrder({ isSettled: false, paymentMethod: "COD" });
    const bill = buildCounterBill(order);
    expect(hasStandaloneToken(bill, "PAID")).toBe(false);
    expect(bill).toContain("COLLECT");
  });

  it("TC11: isSettled true -> both slips contain PAID and no COLLECT", () => {
    const order = makeOrder({ isSettled: true, paymentMethod: "COD" });
    const bill = buildCounterBill(order);
    const kot = buildKitchenKOT(order);
    expect(bill).toContain("PAID");
    expect(kot).toContain("PAID");
    expect(bill).not.toContain("COLLECT");
    expect(kot).not.toContain("COLLECT");
  });

  it("TC12: not settled, Online -> headline is PAYMENT: ONLINE, no COLLECT, no PAID claim", () => {
    const order = makeOrder({ isSettled: false, paymentMethod: "Online" });
    expect(paymentLabel(order)).toEqual({ headline: "PAYMENT: ONLINE", collect: null });

    const bill = buildCounterBill(order);
    const kot = buildKitchenKOT(order);
    expect(bill).toContain("PAYMENT: ONLINE");
    expect(kot).toContain("PAYMENT: ONLINE");
    expect(bill).not.toContain("COLLECT");
    expect(kot).not.toContain("COLLECT");
    expect(bill).not.toContain("PAID");
    expect(kot).not.toContain("PAID");
  });

  it('TC13: not settled, empty paymentMethod -> "PAYMENT: UNCONFIRMED"', () => {
    const order = makeOrder({ isSettled: false, paymentMethod: "" });
    expect(paymentLabel(order)).toEqual({ headline: "PAYMENT: UNCONFIRMED", collect: null });
  });

  it("TC14 (width): 45 long-name items -> every line of both slips is <= 42 chars", () => {
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
