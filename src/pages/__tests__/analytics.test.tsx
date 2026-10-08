import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../types/order";

const { allOrdersMock, reloadMock, pdfMock, toastMock } = vi.hoisted(() => ({
  allOrdersMock: vi.fn(),
  reloadMock: vi.fn(),
  pdfMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../../hooks/useAllOrders", () => ({ useAllOrders: allOrdersMock }));
vi.mock("../../utils/analytics/salesReportPdf", () => ({ downloadSalesReportPdf: pdfMock }));
vi.mock("react-hot-toast", () => ({ default: toastMock }));
vi.mock("../../stores/useAuthStore", () => ({
  useAuthStore: (sel: (s: { shopId: string }) => unknown) => sel({ shopId: "SHOP1" }),
}));

import Analytics from "../Analytics";
import Sidebar from "../../components/Sidebar";
import BottomNav from "../../components/BottomNav";

const order = (id: string, state: string, creationTime: string, gross: number, extra: Partial<Order> = {}) =>
  ({
    orderId: id,
    state,
    creationTime,
    amountExcludingDeliveryFee: gross,
    customerId: 0,
    customerName: `Customer ${id}`,
    customerMobile: 918126633411,
    orderItem: [{ id: 1, name: "Chicken Shawarma Combo", itemCount: 1 }],
    paymentMethod: "COD",
    isSettled: false,
    ...extra,
  }) as unknown as Order;

// Same week as the report tests: net ₹220.18 at 10%, ₹232.41 at 5%; last week ₹1,080.
const ORDERS = [
  order("A", "COMPLETED", "2026-10-05 10:00:00", 110, { customerId: 1 }),
  order("B", "COMPLETED", "2026-10-06 19:30:00", 89.1, { customerId: 2 }),
  order("C", "CANCELLED", "2026-10-06 20:00:00", 256, { customerId: 3 }),
  order("D", "REJECTED", "2026-10-07 21:00:00", 83, { customerId: 4 }),
  order("E", "READY_FOR_PICKUP", "2026-10-08 12:00:00", 236, { customerId: 5 }),
  order("F", "COMPLETED", "2026-10-07 19:10:00", 45.55, { customerId: 1 }),
  order("G", "COMPLETED", "2026-09-29 12:00:00", 200, { customerId: 1 }),
  order("H", "COMPLETED", "2026-10-02 12:00:00", 1000, { customerId: 9, isSettled: true }),
];

const loaded = (over: Record<string, unknown> = {}) => ({
  orders: ORDERS,
  error: null,
  progress: null,
  loadedAt: new Date(2026, 9, 8, 14),
  reload: reloadMock,
  ...over,
});

const hero = () => within(screen.getByRole("region", { name: "Net payout summary" }));
const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 8, 15)); // Thu 8 Oct 2026, 3 PM
  localStorage.clear();
  vi.clearAllMocks();
  allOrdersMock.mockReturnValue(loaded());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Analytics page — loading (TC1)", () => {
  it("shows page progress while the history loads", () => {
    allOrdersMock.mockReturnValue(loaded({ orders: null, loadedAt: null, progress: { loaded: 3, total: 12 } }));
    render(<Analytics />);
    expect(screen.getByText(/Loading your order history… page 3 of 12/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Net payout summary" })).toBeNull();
  });

  it("explains a failed load and retries", async () => {
    allOrdersMock.mockReturnValue(loaded({ orders: null, loadedAt: null, error: "boom" }));
    render(<Analytics />);
    expect(screen.getByText("Couldn't load your orders: boom")).toBeTruthy();
    await click(screen.getByRole("button", { name: "Try again" }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});

describe("Analytics page — settlement weeks (TC2, TC3, TC5)", () => {
  it("TC2: opens on the current settlement week with its payout date", () => {
    render(<Analytics />);
    expect(hero().getAllByText("₹220.18").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mon 5 Oct – Sun 11 Oct 2026").length).toBeGreaterThan(0);
    expect(screen.getByText(/Current week · next payout Mon 12 Oct/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next settlement week" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("TC3: steps back to last week and forward again", async () => {
    render(<Analytics />);
    await click(screen.getByRole("button", { name: "Previous settlement week" }));
    expect(screen.getAllByText("Mon 28 Sep – Sun 4 Oct 2026").length).toBeGreaterThan(0);
    expect(hero().getAllByText("₹1,080").length).toBeGreaterThan(0);

    const next = screen.getByRole("button", { name: "Next settlement week" }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    await click(next);
    expect(hero().getAllByText("₹220.18").length).toBeGreaterThan(0);
  });

  it("TC5: a row in the settlements table opens that week", async () => {
    render(<Analytics />);
    await click(screen.getByRole("button", { name: "28 Sep – 4 Oct" }));
    expect(hero().getAllByText("₹1,080").length).toBeGreaterThan(0);
  });

  it("TC5: All time adds up every completed order; Custom waits for both dates", async () => {
    render(<Analytics />);
    await click(screen.getByRole("button", { name: "All time" }));
    expect(hero().getAllByText("₹1,300.18").length).toBeGreaterThan(0);

    await click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByText("Pick a start and end date to see this period.")).toBeTruthy();
  });

  it("never shows a full phone number", () => {
    render(<Analytics />);
    expect(document.body.textContent).not.toContain("918126633411");
    expect(document.body.textContent).not.toContain("8126633411");
  });
});

describe("Analytics page — commission (TC4)", () => {
  it("switching to 5% recalculates and is remembered for the shop", async () => {
    render(<Analytics />);
    await click(screen.getByRole("button", { name: /Commission 10%/ }));
    await click(screen.getByRole("button", { name: "5%" }));
    expect(hero().getAllByText("₹232.41").length).toBeGreaterThan(0);
    expect(localStorage.getItem("qv_commission_pct:SHOP1")).toBe("5");
  });

  it("rejects an impossible custom rate", async () => {
    render(<Analytics />);
    await click(screen.getByRole("button", { name: /Commission 10%/ }));
    fireEvent.change(screen.getByLabelText("Custom commission percent"), { target: { value: "150" } });
    await click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a number from 0 to 100.");
    expect(hero().getAllByText("₹220.18").length).toBeGreaterThan(0);
    expect(localStorage.getItem("qv_commission_pct:SHOP1")).toBeNull();
  });
});

describe("Download PDF", () => {
  it("downloads the report for exactly what is on screen", async () => {
    pdfMock.mockResolvedValue(undefined);
    render(<Analytics />);
    await click(screen.getByRole("button", { name: "Previous settlement week" }));
    vi.setSystemTime(new Date(2026, 9, 8, 15, 30)); // the vendor downloads half an hour later
    await click(screen.getByRole("button", { name: /Download PDF/ }));

    expect(pdfMock).toHaveBeenCalledTimes(1);
    const [report, meta] = pdfMock.mock.calls[0];
    expect(report.range.start).toEqual(new Date(2026, 8, 28));
    expect(report.kpis.net).toBe(1080);
    expect(meta).toEqual({ shopName: "Store #SHOP1", periodLabel: "Settlement week", isSettlementWeek: true });
    expect(report.generatedAt).toEqual(new Date(2026, 9, 8, 15, 30)); // stamped at download, not at the last click
    expect(toastMock.success).toHaveBeenCalledWith("Sales report downloaded");
  });

  it("says so when the PDF fails", async () => {
    pdfMock.mockRejectedValue(new Error("boom"));
    render(<Analytics />);
    await click(screen.getByRole("button", { name: /Download PDF/ }));
    expect(toastMock.error).toHaveBeenCalledWith("Couldn't create the PDF. Please try again.");
    expect((screen.getByRole("button", { name: /Download PDF/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("navigation (TC6)", () => {
  it("Sidebar and BottomNav link to Analytics", () => {
    render(
      <MemoryRouter>
        <Sidebar isMobileOpen={false} onMobileClose={() => {}} />
        <BottomNav />
      </MemoryRouter>
    );
    const links = screen.getAllByRole("link", { name: /Analytics/ });
    expect(links).toHaveLength(2);
    links.forEach((l) => expect(l.getAttribute("href")).toBe("/vendor/analytics"));
  });
});
