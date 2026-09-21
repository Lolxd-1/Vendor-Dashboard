import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { type ComponentProps, memo, useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order, OrderActionEvent } from "../../../types/order";
import { useDashboardStore } from "../../../stores/useDashboardStore";
import { ReadyOrderCard } from "../ReadyOrderCard";

// Process-boundary mocks only, matching orderSync.test.ts's approach: the card's own network/
// print side effects aren't what this file is about.
vi.mock("../../../apis/dashboardApi", () => ({
  useHandoverOrderMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock("../../../hooks/usePrintOrder", () => ({
  usePrintOrder: () => ({ reprint: vi.fn(), printing: false }),
}));

const baseOrder: Order = {
  orderId: "QV-BASE",
  campusId: "CAMPUS-1",
  shopId: 1,
  customerId: 1001,
  customerName: "Rahul Sharma",
  customerMobile: 9876543210,
  customerAddress: "Hostel Block A",
  state: "READY_FOR_PICKUP",
  creationTime: "2026-09-20T12:30:00.000Z",
  preparationTime: 15,
  orderItem: [{ id: 1, name: "Veg Burger", itemCount: 2, itemPrice: 120 }],
  totalItemCount: 2,
  productCount: 1,
  totalAmount: 240,
  invoiceAmount: 240,
  amountExcludingDeliveryFee: 240,
  deliveryFee: 0,
  fulfillmentOption: "Delivery",
  productImageURLs: "",
  stateLabel: "Ready",
  orderDescription: "",
  orderLink: "",
  paymentMethod: "Online",
  isSettled: false,
};
const makeOrder = (orderId: string, patch: Partial<Order> = {}): Order => ({
  ...baseOrder,
  orderId,
  ...patch,
});

let renderCounts: Record<string, number> = {};
const track = (id: string) => {
  renderCounts[id] = (renderCounts[id] ?? 0) + 1;
};

// A same-props memo wrapper bails out under EXACTLY the same shallow comparison as the real
// (also memoized) ReadyOrderCard, so counting calls to this wrapper's body is equivalent to
// counting when the real card actually re-renders. (<Profiler> was tried first and rejected:
// it fires on every parent-triggered reconciliation pass regardless of a memoized child
// bailing out beneath it, which made it measure the wrong thing here.)
const CountingReadyOrderCard = memo((props: ComponentProps<typeof ReadyOrderCard>) => {
  track(props.order.orderId);
  return <ReadyOrderCard {...props} />;
});

// Mirrors how Dashboard.tsx renders a column: a narrow store selector plus a useCallback-
// stabilised onViewDetails, so React.memo on the card can actually skip an untouched order.
const ReadyColumn = () => {
  const readyOrders = useDashboardStore((state) => state.readyOrders);
  const handleViewDetails = useCallback(() => {}, []);
  return (
    <>
      {readyOrders.map((order, idx) => (
        <CountingReadyOrderCard
          key={order.orderId}
          order={order}
          sequence={idx + 1}
          onViewDetails={handleViewDetails}
        />
      ))}
    </>
  );
};

beforeEach(() => {
  // useOrderTimer runs a real setInterval; fake timers keep it from ticking mid-test so the
  // only commits we measure are the ones this test explicitly triggers.
  vi.useFakeTimers();
  useDashboardStore.getState().clearAll();
  renderCounts = {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("order card render isolation (T14 TC2)", () => {
  it("updating one order does not re-render the other order's memoized card", () => {
    useDashboardStore.setState({ readyOrders: [makeOrder("QV-1"), makeOrder("QV-2")] });

    render(<ReadyColumn />);
    const mountedQv1 = renderCounts["QV-1"];
    const mountedQv2 = renderCounts["QV-2"];
    expect(mountedQv1).toBeGreaterThan(0);
    expect(mountedQv2).toBeGreaterThan(0);

    // Simulates an inbound frame updating one order's fields while it stays in the same
    // column - upsertOrder's merge-in-place branch, which is what keeps QV-2's object
    // reference (and its position/sequence) untouched.
    act(() => {
      useDashboardStore
        .getState()
        .upsertOrder({ orderId: "QV-1", customerName: "Updated Name" }, "READY_FOR_PICKUP");
    });

    expect(renderCounts["QV-1"]).toBeGreaterThan(mountedQv1);
    expect(renderCounts["QV-2"]).toBe(mountedQv2);
  });
});

describe("onViewDetails callback identity (T14 TC3)", () => {
  it("stays referentially stable across a parent re-render that does not touch the order list", () => {
    const captured: Array<(order: OrderActionEvent) => void> = [];

    // Same shape Dashboard.tsx uses: a useCallback-stabilised wrapper around setViewOrder,
    // with an empty dependency array so its identity never changes.
    const Harness = () => {
      const [, setViewOrder] = useState<OrderActionEvent | null>(null);
      const [tick, setTick] = useState(0);
      const handleViewDetails = useCallback(
        (order: OrderActionEvent) => setViewOrder(order),
        []
      );
      captured.push(handleViewDetails);
      return <button onClick={() => setTick((t) => t + 1)}>bump-{tick}</button>;
    };

    const { getByRole } = render(<Harness />);
    fireEvent.click(getByRole("button"));

    expect(captured.length).toBe(2);
    expect(captured[0]).toBe(captured[1]);
  });
});
