import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDashboardStore } from "../../stores/useDashboardStore";
import * as Alert from "../../utils/order-alert";
import Layout from "../Dashboardlayout";

// The ring is module-level state in order-alert.ts with sourceNode.loop = true, so
// "did Layout call stop()" IS the whole question: nothing else can silence it.
vi.mock("../../utils/order-alert", () => ({
  ring: vi.fn(async () => true),
  stop: vi.fn(),
  arm: vi.fn(async () => true),
  getState: () => ({ armed: true, ringing: false, blocked: false }),
  subscribe: () => () => {},
}));

// Process boundaries only: the socket would open a real SockJS connection, and the
// chrome around the Outlet is not what this file is about.
vi.mock("../../hooks/useOrderWebsocket", () => ({
  useOrderWebsocket: () => ({ isConnected: true, lastMessageAt: null }),
}));
vi.mock("../../components/Sidebar", () => ({ default: () => null }));
vi.mock("../../components/Navbar", () => ({ default: () => null }));
vi.mock("../../components/BottomNav", () => ({ default: () => null }));
vi.mock("../../components/SoundStatusChip", () => ({ default: () => null }));

const renderLayout = async () => {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    );
  });
  return view;
};

beforeEach(() => {
  useDashboardStore.getState().clearAll();
  vi.mocked(Alert.stop).mockClear();
  vi.mocked(Alert.ring).mockClear();
});

afterEach(() => {
  cleanup();
});

describe("Layout ring lifecycle", () => {
  it("TC-C1 (THE BUG): unmounting with orders still pending stops the ring", async () => {
    useDashboardStore.getState().upsertOrder({ orderId: "QV-RING" }, "PENDING");
    const { unmount } = await renderLayout();

    // Precondition: the ring is going and the effect body's stop() is unreachable,
    // because that branch only runs when pendingOrders.length === 0.
    expect(Alert.ring).toHaveBeenCalled();
    expect(Alert.stop).not.toHaveBeenCalled();

    // T04's expiry logout flips isAuthenticated, ProtectedRoute renders <Navigate/>,
    // and Layout unmounts with three orders still on the board.
    await act(async () => {
      unmount();
    });

    expect(Alert.stop).toHaveBeenCalled();
  });

  it("TC-C1b: an ordinary re-render while orders are pending does NOT stop the ring", async () => {
    useDashboardStore.getState().upsertOrder({ orderId: "QV-1" }, "PENDING");
    await renderLayout();

    // A poll landing a second order re-runs the [pendingOrders] effect. If stop()
    // hung off that effect's cleanup instead of an unmount-scoped one, the ring
    // would cut out every 10s between polls.
    await act(async () => {
      useDashboardStore.getState().upsertOrder({ orderId: "QV-2" }, "PENDING");
    });

    expect(useDashboardStore.getState().pendingOrders).toHaveLength(2);
    expect(Alert.stop).not.toHaveBeenCalled();
  });

  it("TC-C1c: the title is still restored on unmount", async () => {
    useDashboardStore.getState().upsertOrder({ orderId: "QV-1" }, "PENDING");
    const { unmount } = await renderLayout();

    await act(async () => {
      unmount();
    });

    expect(document.title).toBe("QuickVerse Vendor");
  });
});
