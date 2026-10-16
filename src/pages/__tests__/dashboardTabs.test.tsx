import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../types/order";
import { useDashboardStore } from "../../stores/useDashboardStore";
import Dashboard from "../Dashboard";

// Process-boundary mocks only: no network, no print agent, simple cards.
vi.mock("react-router-dom", () => ({ useOutletContext: () => ({}) }));
vi.mock("../../apis/orderApi", () => ({
  useGetVendorOrdersQuery: () => ({ data: undefined, fulfilledTimeStamp: undefined }),
}));
vi.mock("../../hooks/useDashboardStats", () => ({
  useDashboardStats: () => ({ isFetching: false, refresh: vi.fn() }),
}));
vi.mock("../../hooks/useOrderSync", () => ({ useOrderSync: () => undefined }));
vi.mock("../../utils/print/printAgent", () => ({
  checkAgentOnline: async () => false,
  getAgentQueue: async () => [],
  getPrinterSettings: () => ({ counterPrinter: "", kitchenPrinter: "", agentPort: 1818 }),
}));
vi.mock("../../components/dashboard/SummaryStatsRow", () => ({ SummaryStatsRow: () => null }));
vi.mock("../../components/dashboard/PendingOrderCard", () => ({
  PendingOrderCard: ({ order }: { order: Order }) => <div>pending {order.orderId}</div>,
}));
vi.mock("../../components/dashboard/AcceptedOrderCard", () => ({
  AcceptedOrderCard: ({ order }: { order: Order }) => <div>accepted {order.orderId}</div>,
}));
vi.mock("../../components/dashboard/ReadyOrderCard", () => ({
  ReadyOrderCard: ({ order }: { order: Order }) => <div>ready {order.orderId}</div>,
}));

const order = (orderId: string) => ({ orderId, orderItem: [{ id: 1, name: "Tea", itemCount: 1, itemPrice: 20 }] }) as Order;

const setPending = (ids: string[]) => act(() => useDashboardStore.setState({ pendingOrders: ids.map(order) }));

// The mobile tab buttons are the only buttons whose text starts with the tab label.
const tabButton = (label: string) => screen.getAllByRole("button").find((b) => b.textContent?.startsWith(label))!;

beforeEach(() => useDashboardStore.setState({ pendingOrders: [], acceptedOrders: [], readyOrders: [] }));
afterEach(cleanup);

describe("Dashboard mobile tabs — auto-switch to Pending", () => {
  it("jumps back to Pending when a new order arrives while another tab is open", () => {
    render(<Dashboard />);
    expect(screen.getByText("No pending orders")).toBeTruthy();

    fireEvent.click(tabButton("Accepted"));
    expect(screen.getByText("No accepted orders")).toBeTruthy();

    setPending(["QV-1"]);
    expect(screen.queryByText("No accepted orders")).toBeNull();
    expect(screen.getAllByText("pending QV-1")).toHaveLength(2); // desktop column + mobile tab
  });

  it("does not switch when the pending count drops or stays the same", () => {
    setPending(["QV-1", "QV-2"]);
    render(<Dashboard />);

    fireEvent.click(tabButton("Ready"));
    expect(screen.getByText("No ready orders")).toBeTruthy();

    setPending(["QV-1"]); // one accepted elsewhere
    expect(screen.getByText("No ready orders")).toBeTruthy();

    setPending(["QV-3"]); // same count, different order
    expect(screen.getByText("No ready orders")).toBeTruthy();
  });

  it("does not switch on first render when orders are already pending", () => {
    setPending(["QV-1"]);
    render(<Dashboard />);
    fireEvent.click(tabButton("Accepted"));
    expect(screen.getByText("No accepted orders")).toBeTruthy();
  });
});
