import { beforeEach, describe, expect, it } from "vitest";
import { normalisePhase, useDashboardStore } from "../useDashboardStore";
import type { Order } from "../../types/order";

const baseOrder: Order = {
  orderId: "QV-2026-000001",
  campusId: "CAMPUS-1",
  shopId: 1,
  customerId: 1001,

  customerName: "Rahul Sharma",
  customerMobile: 9876543210,
  customerAddress: "Hostel Block A, Near Gate 2",

  state: "PENDING",
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
  stateLabel: "Pending",
  orderDescription: "",
  orderLink: "",
  paymentMethod: "Online",
  isSettled: false,
};

const makeOrder = (orderId: string, state: string): Order => ({ ...baseOrder, orderId, state });

const store = () => useDashboardStore.getState();

beforeEach(() => {
  store().clearAll();
});

describe("normalisePhase", () => {
  it("TC1: reads any casing and surrounding whitespace as the same phase", () => {
    expect(normalisePhase("ACCEPTED")).toBe("ACCEPTED");
    expect(normalisePhase("accepted")).toBe("ACCEPTED");
    expect(normalisePhase(" Accepted ")).toBe("ACCEPTED");
  });

  it("TC2: returns null for terminal, unknown and non-string values", () => {
    expect(normalisePhase("REJECTED")).toBeNull();
    expect(normalisePhase("GARBAGE")).toBeNull();
    expect(normalisePhase(undefined)).toBeNull();
    expect(normalisePhase(null)).toBeNull();
    expect(normalisePhase(42)).toBeNull();
  });
});

describe("upsertOrder", () => {
  it("TC3: an order accepted elsewhere leaves Pending and lands in Accepted", () => {
    useDashboardStore.setState({ pendingOrders: [makeOrder("QV-1", "PENDING")] });

    store().upsertOrder({ orderId: "QV-1" }, "ACCEPTED");

    expect(store().pendingOrders).toHaveLength(0);
    expect(store().acceptedOrders).toHaveLength(1);
    expect(store().acceptedOrders[0].orderId).toBe("QV-1");
  });

  it("TC4: moves an accepted order on to Ready", () => {
    useDashboardStore.setState({ acceptedOrders: [makeOrder("QV-1", "ACCEPTED")] });

    store().upsertOrder({ orderId: "QV-1" }, "READY_FOR_PICKUP");

    expect(store().acceptedOrders).toHaveLength(0);
    expect(store().readyOrders).toHaveLength(1);
    expect(store().readyOrders[0].orderId).toBe("QV-1");
  });

  it("TC5: inserts an order this tab has never seen instead of dropping it", () => {
    store().upsertOrder(makeOrder("QV-NEW", "ACCEPTED"), "ACCEPTED");

    expect(store().acceptedOrders).toHaveLength(1);
    expect(store().acceptedOrders[0].orderId).toBe("QV-NEW");
    expect(store().pendingOrders).toHaveLength(0);
    expect(store().readyOrders).toHaveLength(0);
  });

  it("TC6: merges incoming fields over the existing order", () => {
    useDashboardStore.setState({ pendingOrders: [makeOrder("QV-1", "PENDING")] });

    store().upsertOrder({ orderId: "QV-1", customerName: "Asha" }, "ACCEPTED");

    const merged = store().acceptedOrders[0];
    expect(merged.customerName).toBe("Asha");
    expect(merged.orderItem).toEqual(baseOrder.orderItem);
  });

  it("TC7: is idempotent — a repeated message leaves exactly one copy", () => {
    useDashboardStore.setState({ pendingOrders: [makeOrder("QV-1", "PENDING")] });

    store().upsertOrder({ orderId: "QV-1" }, "ACCEPTED");
    store().upsertOrder({ orderId: "QV-1" }, "ACCEPTED");

    expect(store().acceptedOrders).toHaveLength(1);
    expect(store().pendingOrders).toHaveLength(0);
    expect(store().readyOrders).toHaveLength(0);
  });

  it("TC8: stamps state with the target phase so setInitialOrders buckets it the same way", () => {
    useDashboardStore.setState({ pendingOrders: [makeOrder("QV-1", "PENDING")] });

    store().upsertOrder({ orderId: "QV-1" }, "ACCEPTED");
    expect(store().acceptedOrders[0].state).toBe("ACCEPTED");

    store().upsertOrder({ orderId: "QV-1" }, "READY_FOR_PICKUP");
    expect(store().readyOrders[0].state).toBe("READY_FOR_PICKUP");

    store().upsertOrder({ orderId: "QV-1" }, "PENDING");
    expect(store().pendingOrders[0].state).toBe("PENDING");
  });

  it("TC9: drives pendingOrders.length, which is the only thing that stops the ring", () => {
    useDashboardStore.setState({ pendingOrders: [makeOrder("QV-1", "PENDING")] });
    expect(store().pendingOrders).toHaveLength(1);

    store().upsertOrder({ orderId: "QV-1" }, "ACCEPTED");
    expect(store().pendingOrders).toHaveLength(0);

    store().upsertOrder(makeOrder("QV-2", "PENDING"), "PENDING");
    expect(store().pendingOrders).toHaveLength(1);
  });

  it("TC10: leaves the untouched column alone and preserves the order of the rest", () => {
    useDashboardStore.setState({
      pendingOrders: [makeOrder("P1", "PENDING"), makeOrder("P2", "PENDING")],
      acceptedOrders: [makeOrder("A1", "ACCEPTED")],
      readyOrders: [makeOrder("R1", "READY_FOR_PICKUP")],
    });
    const readyBefore = store().readyOrders;

    store().upsertOrder({ orderId: "P1", customerName: "Asha" }, "ACCEPTED");

    expect(store().readyOrders).toEqual(readyBefore);
    expect(store().pendingOrders.map(o => o.orderId)).toEqual(["P2"]);
    expect(store().acceptedOrders.map(o => o.orderId)).toEqual(["A1", "P1"]);
  });
});
