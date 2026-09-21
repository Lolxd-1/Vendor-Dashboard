import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRACE_MS, normalisePhase, useDashboardStore } from "../useDashboardStore";
import type { Order } from "../../types/order";
import { setOrderStamp } from "../../utils/print/printLedger";

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
  sessionStorage.clear(); // a stamp written by one test must not leak into the next
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

    // QV-1 itself can no longer go back to Pending (forward-only), so the
    // PENDING stamp is proven on an order the store has not seen before.
    store().upsertOrder(makeOrder("QV-2", "ACCEPTED"), "PENDING");
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

describe("reconcile", () => {
  // The clock is fixed so "just arrived" and "aged out" are exact, not racy.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("TC1: keeps an order the socket delivered but the poll has not indexed yet", () => {
    store().addPendingOrder(makeOrder("QV-LIVE", "PENDING"));

    store().reconcile([]);

    expect(store().pendingOrders.map(o => o.orderId)).toEqual(["QV-LIVE"]);
  });

  it("TC2: leaves pendingOrders.length at 1 in that case, so the ring keeps going", () => {
    store().addPendingOrder(makeOrder("QV-LIVE", "PENDING"));

    store().reconcile([]);

    expect(store().pendingOrders).toHaveLength(1);
  });

  it("TC3: drops an absent order once it is older than GRACE_MS", () => {
    store().addPendingOrder(makeOrder("QV-LIVE", "PENDING"));

    vi.advanceTimersByTime(GRACE_MS + 1);
    store().reconcile([]);

    expect(store().pendingOrders).toHaveLength(0);
  });

  it("TC4: moves an order the server reports as ACCEPTED, leaving it in no other column", () => {
    store().addPendingOrder(makeOrder("QV-1", "PENDING"));

    store().reconcile([makeOrder("QV-1", "ACCEPTED")]);

    expect(store().acceptedOrders.map(o => o.orderId)).toEqual(["QV-1"]);
    expect(store().pendingOrders).toHaveLength(0);
    expect(store().readyOrders).toHaveLength(0);
  });

  it("TC5: does not let a null acceptedDate from the API clobber the session stamp", () => {
    setOrderStamp("QV-1", "acceptedAt", "2026-09-20T07:00:00.000Z");

    store().reconcile([{ ...makeOrder("QV-1", "ACCEPTED"), acceptedDate: null }]);

    expect(store().acceptedOrders[0].acceptedDate).toBe("2026-09-20T07:00:00.000Z");
  });

  it("TC6: keeps a locally-set preparationTime when the poll returns null", () => {
    store().addPendingOrder(makeOrder("QV-1", "PENDING"));
    store().moveToAccepted("QV-1", 25);

    store().reconcile([{ ...makeOrder("QV-1", "ACCEPTED"), preparationTime: null as unknown as number }]);

    expect(store().acceptedOrders[0].preparationTime).toBe(25);
  });

  it("TC7: an empty poll right after the orders arrived keeps all three columns", () => {
    store().addPendingOrder(makeOrder("P1", "PENDING"));
    store().upsertOrder(makeOrder("A1", "ACCEPTED"), "ACCEPTED");
    store().upsertOrder(makeOrder("R1", "READY_FOR_PICKUP"), "READY_FOR_PICKUP");

    store().reconcile([]);

    expect(store().pendingOrders.map(o => o.orderId)).toEqual(["P1"]);
    expect(store().acceptedOrders.map(o => o.orderId)).toEqual(["A1"]);
    expect(store().readyOrders.map(o => o.orderId)).toEqual(["R1"]);
  });

  it("TC8: treats a failed poll (undefined/null) as no news instead of wiping the board", () => {
    store().addPendingOrder(makeOrder("P1", "PENDING"));
    const before = store().pendingOrders;

    expect(() => store().reconcile(undefined as unknown as Order[])).not.toThrow();
    expect(() => store().reconcile(null as unknown as Order[])).not.toThrow();

    expect(store().pendingOrders).toBe(before);
  });

  it("TC9: an order in both the store and the server list appears exactly once", () => {
    store().addPendingOrder(makeOrder("QV-1", "PENDING"));

    store().reconcile([makeOrder("QV-1", "PENDING")]);

    expect(store().pendingOrders.map(o => o.orderId)).toEqual(["QV-1"]);
    expect(store().acceptedOrders).toHaveLength(0);
    expect(store().readyOrders).toHaveLength(0);
  });

  it("TC10: two polls with the same server list produce the same ordering", () => {
    store().addPendingOrder(makeOrder("LOCAL", "PENDING"));
    const serverList = [makeOrder("S1", "PENDING"), makeOrder("S2", "PENDING")];

    store().reconcile(serverList);
    const afterFirst = store().pendingOrders.map(o => o.orderId);
    store().reconcile(serverList);

    expect(afterFirst).toEqual(["S1", "S2", "LOCAL"]);
    expect(store().pendingOrders.map(o => o.orderId)).toEqual(afterFirst);
  });

  it("TC11: does not resurrect an order the socket cancelled", () => {
    store().addPendingOrder(makeOrder("QV-1", "PENDING"));
    store().removeOrder("QV-1");

    store().reconcile([]);

    expect(store().pendingOrders).toHaveLength(0);
  });

  it("TC15: is exempt from forward-only, so the server can revert an order", () => {
    store().upsertOrder(makeOrder("QV-1", "ACCEPTED"), "ACCEPTED");

    store().reconcile([makeOrder("QV-1", "PENDING")]);

    expect(store().pendingOrders.map(o => o.orderId)).toEqual(["QV-1"]);
    expect(store().acceptedOrders).toHaveLength(0);
  });

  // ─── C2: __receivedAt means "last time we had evidence this order exists" ───

  it("TC17 (THE BUG): an order the polls kept confirming survives a later poll that omits it", () => {
    store().addPendingOrder(makeOrder("QV-1", "PENDING"));

    // The kitchen is slammed and the card sits in Pending for over two minutes.
    // Every poll in that window returns it, so the server never stopped seeing it.
    for (let i = 0; i < 13; i++) {
      vi.advanceTimersByTime(10_000);
      store().reconcile([makeOrder("QV-1", "PENDING")]);
    }

    // Now one poll omits it — a shard timeout the API swallows into a partial list.
    store().reconcile([]);

    expect(store().pendingOrders.map(o => o.orderId)).toEqual(["QV-1"]);
  });

  it("TC18: an order present in serverOrders always carries a fresh __receivedAt", () => {
    store().reconcile([makeOrder("QV-1", "PENDING")]);

    expect(store().pendingOrders[0].__receivedAt).toBe(Date.now());

    vi.advanceTimersByTime(60_000);
    store().reconcile([makeOrder("QV-1", "PENDING")]);

    expect(store().pendingOrders[0].__receivedAt).toBe(Date.now());
  });

  it("TC19: an order re-added by a poll gets a full grace window, not zero", () => {
    store().reconcile([makeOrder("QV-1", "PENDING")]);

    vi.advanceTimersByTime(GRACE_MS - 1);
    store().reconcile([]);

    expect(store().pendingOrders.map(o => o.orderId)).toEqual(["QV-1"]);
  });

  // ─── I7: bucket through normalisePhase, never on a raw string compare ───

  it("TC20: a server order with lower-case state is bucketed into Pending, not dropped", () => {
    store().addPendingOrder(makeOrder("QV-1", "PENDING"));

    store().reconcile([makeOrder("QV-1", "pending")]);

    expect(store().pendingOrders.map(o => o.orderId)).toEqual(["QV-1"]);
    expect(store().acceptedOrders).toHaveLength(0);
    expect(store().readyOrders).toHaveLength(0);
  });

  it("TC21: a padded ACCEPTED lands in Accepted", () => {
    store().reconcile([makeOrder("QV-1", " Accepted ")]);

    expect(store().acceptedOrders.map(o => o.orderId)).toEqual(["QV-1"]);
  });

  it("TC22: a server state that does not normalise leaves the local copy alone", () => {
    store().addPendingOrder(makeOrder("QV-1", "PENDING"));

    store().reconcile([makeOrder("QV-1", "SOME_NEW_STATE")]);

    expect(store().pendingOrders.map(o => o.orderId)).toEqual(["QV-1"]);
  });

  // ─── I9: a stale poll must not undo what this client just did ───

  it("TC23: a stale PENDING poll does not pull back an order THIS client just accepted", () => {
    store().addPendingOrder(makeOrder("QV-1", "PENDING"));
    store().moveToAccepted("QV-1", 15); // writes the acceptedAt session stamp

    store().reconcile([makeOrder("QV-1", "PENDING")]); // replica lag

    expect(store().acceptedOrders.map(o => o.orderId)).toEqual(["QV-1"]);
    expect(store().pendingOrders).toHaveLength(0);
  });

  it("TC24: once the local stamp is older than GRACE_MS the server wins again", () => {
    store().addPendingOrder(makeOrder("QV-1", "PENDING"));
    store().moveToAccepted("QV-1", 15);

    vi.advanceTimersByTime(GRACE_MS + 1);
    store().reconcile([makeOrder("QV-1", "PENDING")]);

    expect(store().pendingOrders.map(o => o.orderId)).toEqual(["QV-1"]);
    expect(store().acceptedOrders).toHaveLength(0);
  });

  it("TC25: the guard is one-directional — a FORWARD move from the server still lands", () => {
    store().addPendingOrder(makeOrder("QV-1", "PENDING"));
    store().moveToAccepted("QV-1", 15);

    store().reconcile([makeOrder("QV-1", "READY_FOR_PICKUP")]);

    expect(store().readyOrders.map(o => o.orderId)).toEqual(["QV-1"]);
    expect(store().acceptedOrders).toHaveLength(0);
  });
});

describe("upsertOrder is forward-only", () => {
  it("TC12: ignores a stale PENDING re-broadcast for an order already accepted", () => {
    store().upsertOrder(makeOrder("QV-1", "ACCEPTED"), "ACCEPTED");

    store().upsertOrder(makeOrder("QV-1", "PENDING"), "PENDING");

    expect(store().acceptedOrders.map(o => o.orderId)).toEqual(["QV-1"]);
    expect(store().pendingOrders).toHaveLength(0);
  });

  it("TC13: still moves an order forward through both transitions", () => {
    store().addPendingOrder(makeOrder("QV-1", "PENDING"));

    store().upsertOrder({ orderId: "QV-1" }, "ACCEPTED");
    expect(store().acceptedOrders.map(o => o.orderId)).toEqual(["QV-1"]);

    store().upsertOrder({ orderId: "QV-1" }, "READY_FOR_PICKUP");
    expect(store().readyOrders.map(o => o.orderId)).toEqual(["QV-1"]);
    expect(store().acceptedOrders).toHaveLength(0);
  });

  it("TC14: still inserts an unknown order arriving at a later phase", () => {
    store().upsertOrder(makeOrder("QV-NEW", "ACCEPTED"), "ACCEPTED");

    expect(store().acceptedOrders.map(o => o.orderId)).toEqual(["QV-NEW"]);
  });

  it("TC16: merges a repeated same-phase message in place instead of re-appending", () => {
    useDashboardStore.setState({
      acceptedOrders: [makeOrder("A1", "ACCEPTED"), makeOrder("A2", "ACCEPTED"), makeOrder("A3", "ACCEPTED")],
    });

    store().upsertOrder({ orderId: "A1", customerName: "Asha" }, "ACCEPTED");

    expect(store().acceptedOrders.map(o => o.orderId)).toEqual(["A1", "A2", "A3"]);
    expect(store().acceptedOrders[0].customerName).toBe("Asha");
  });
});
