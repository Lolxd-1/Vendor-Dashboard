import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../../types/order";
import { markAcceptUnconfirmed, markPrinted, pruneLedger, wasAcceptUnconfirmed, wasPrinted } from "../../../utils/print/printLedger";
import { AcceptedOrderCard } from "../AcceptedOrderCard";

// I10: an accept that failed on the wire but committed server-side reaches
// Accepted via the poll with no bill and no KOT. The card must say so for as
// long as that is true, not just for an 8s toast.

const { reprintMock } = vi.hoisted(() => ({ reprintMock: vi.fn() }));

vi.mock("../../../apis/dashboardApi", () => ({
  useMarkOrderReadyMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock("../../../hooks/usePrintOrder", () => ({
  usePrintOrder: () => ({ reprint: reprintMock, printing: false }),
}));

const order = {
  orderId: "QV-I10",
  customerName: "Rahul Sharma",
  customerMobile: 9876543210,
  state: "ACCEPTED",
  creationTime: "2026-09-20T12:30:00.000Z",
  preparationTime: 15,
  orderItem: [{ id: 1, name: "Veg Burger", itemCount: 2, itemPrice: 120 }],
  amountExcludingDeliveryFee: 240,
} as Order;

const renderCard = () =>
  render(<AcceptedOrderCard order={order} sequence={1} onViewDetails={() => {}} />);

const banner = () => screen.queryByText(/not printed/i);

beforeEach(() => {
  sessionStorage.clear();
  reprintMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("accept-unconfirmed ledger stamp", () => {
  it("TC-I10c: round-trips per order", () => {
    expect(wasAcceptUnconfirmed("QV-I10")).toBe(false);
    markAcceptUnconfirmed("QV-I10");
    expect(wasAcceptUnconfirmed("QV-I10")).toBe(true);
    expect(wasAcceptUnconfirmed("QV-OTHER")).toBe(false);
  });

  it("TC-I10d: is a ledger family, so pruning bounds it like the other stamps", () => {
    markAcceptUnconfirmed("QV-I10");
    sessionStorage.setItem("qv_counter_printer", "EPSON");
    expect(pruneLedger(0)).toBe(1);
    expect(wasAcceptUnconfirmed("QV-I10")).toBe(false);
    expect(sessionStorage.getItem("qv_counter_printer")).toBe("EPSON");
  });
});

describe("AcceptedOrderCard — durable 'not printed' marker (I10)", () => {
  it("TC-I10e: no marker for an order accepted normally", () => {
    renderCard();
    expect(banner()).toBeNull();
  });

  it("TC-I10f: shows the marker when this PC's accept failed and nothing printed", () => {
    markAcceptUnconfirmed("QV-I10");
    renderCard();
    expect(banner()).not.toBeNull();
  });

  it("TC-I10g: no marker once the order has printed on this PC", () => {
    markAcceptUnconfirmed("QV-I10");
    markPrinted("QV-I10");
    renderCard();
    expect(banner()).toBeNull();
  });

  it("TC-I10h: Print Bill + KOT prints both slips and clears the marker on success", async () => {
    markAcceptUnconfirmed("QV-I10");
    reprintMock.mockResolvedValue(true);
    renderCard();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /print bill \+ kot/i }));
    });

    expect(reprintMock).toHaveBeenCalledTimes(1);
    expect(reprintMock).toHaveBeenCalledWith(order, "both");
    expect(banner()).toBeNull();
    expect(wasPrinted("QV-I10")).toBe(true);
  });

  it("TC-I10i: the marker stays when that print fails", async () => {
    markAcceptUnconfirmed("QV-I10");
    reprintMock.mockResolvedValue(false);
    renderCard();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /print bill \+ kot/i }));
    });

    expect(banner()).not.toBeNull();
    expect(wasPrinted("QV-I10")).toBe(false);
  });
});
