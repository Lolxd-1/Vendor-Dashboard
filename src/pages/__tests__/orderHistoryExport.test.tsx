import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../types/order";

const { queryMock, downloadMock, printItemsMock, loadAllMock, toastMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  downloadMock: vi.fn(),
  printItemsMock: vi.fn(),
  loadAllMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../../apis/orderApi", () => ({ useGetVendorOrdersQuery: queryMock }));
vi.mock("../../stores/useAuthStore", () => ({
  useAuthStore: (sel: (s: { shopId: string }) => unknown) => sel({ shopId: "SHOP1" }),
}));
vi.mock("../../utils/exportOrders", () => ({ downloadOrdersCsv: downloadMock }));
vi.mock("../../utils/print/itemsSummary", () => ({ printItemsSummary: printItemsMock }));
vi.mock("../../hooks/useLoadAllOrders", () => ({ useLoadAllOrders: () => loadAllMock }));
vi.mock("react-hot-toast", () => ({ default: toastMock }));
vi.mock("../../components/common/OrderDetailsModal", () => ({ OrderDetailsModal: () => null }));

import OrderHistory from "../OrderHistory";

const makeOrders = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    orderId: `ORD-${i + 1}`,
    customerName: "Ravi",
    creationTime: "2026-10-02 20:57:10",
    state: "COMPLETED",
    totalItemCount: 1,
    amountExcludingDeliveryFee: 100,
    orderItem: [],
  })) as unknown as Order[];

const queryResult = (over: Record<string, unknown> = {}) => ({
  data: makeOrders(50), // the table only ever gets the backend's first page
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  ...over,
});

const ALL_ORDERS = makeOrders(386); // what loading every page returns

const exportButton = () => screen.getByRole("button", { name: /export/i }) as HTMLButtonElement;
const printButton = () => screen.getByRole("button", { name: /print items/i }) as HTMLButtonElement;
const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockReturnValue(queryResult());
  loadAllMock.mockResolvedValue(ALL_ORDERS);
  printItemsMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("Order History Export button", () => {
  it("loads every page for the filter and exports all of them, not just the 50 in the table", async () => {
    render(<OrderHistory />);
    await click(exportButton());
    expect(loadAllMock).toHaveBeenCalledWith({
      shopId: "SHOP1", orderStatus: undefined, timeRange: undefined, fromTime: undefined, toTime: undefined,
    });
    expect(downloadMock).toHaveBeenCalledTimes(1);
    const [orders, filters] = downloadMock.mock.calls[0];
    expect(orders).toHaveLength(386);
    expect(filters).toEqual({ status: undefined, timeRange: undefined, from: null, to: null });
    expect(toastMock.success).toHaveBeenCalledWith("Exported 386 orders");
  });

  it("loads with the same filters the table uses", async () => {
    render(<OrderHistory />);
    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    const tableArgs = queryMock.mock.calls[queryMock.mock.calls.length - 1][0];
    expect(tableArgs).toEqual(expect.objectContaining({ shopId: "SHOP1", orderStatus: ["COMPLETED"], timeRange: "THIS_MONTH" }));
    await click(exportButton());
    expect(loadAllMock).toHaveBeenCalledWith(tableArgs);
    expect(downloadMock.mock.calls[0][1]).toEqual(expect.objectContaining({ status: "COMPLETED", timeRange: "THIS_MONTH" }));
  });

  it("exports nothing when loading failed", async () => {
    loadAllMock.mockResolvedValue(null);
    render(<OrderHistory />);
    await click(exportButton());
    expect(downloadMock).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("exports nothing when the full load finds no orders", async () => {
    loadAllMock.mockResolvedValue([]);
    render(<OrderHistory />);
    await click(exportButton());
    expect(downloadMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith("No orders found for this filter");
  });

  it.each([
    ["loading", { isLoading: true, data: [] }],
    ["refreshing / filter change in flight", { isFetching: true }],
    ["the request failed", { isError: true }],
    ["there are no orders", { data: [] }],
  ])("is disabled while %s", async (_label, over) => {
    queryMock.mockReturnValue(queryResult(over));
    render(<OrderHistory />);
    expect(exportButton().disabled).toBe(true);
    await click(exportButton());
    expect(loadAllMock).not.toHaveBeenCalled();
  });

  it("leaves the Refresh button working", () => {
    const refetch = vi.fn();
    queryMock.mockReturnValue(queryResult({ refetch }));
    render(<OrderHistory />);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("Order History Print Items button", () => {
  it("is disabled on 'All time' so years of items never go on paper", () => {
    render(<OrderHistory />);
    expect(printButton().disabled).toBe(true);
    expect(printButton().title).toMatch(/pick a time period/i);
  });

  it("stays disabled for Custom until both dates are picked", () => {
    render(<OrderHistory />);
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(printButton().disabled).toBe(true);
  });

  it("prints ONE summary of every order of the period (all pages)", async () => {
    render(<OrderHistory />);
    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    fireEvent.click(screen.getByRole("button", { name: "Last Week" }));
    expect(printButton().disabled).toBe(false);
    await click(printButton());
    expect(loadAllMock).toHaveBeenCalledWith(expect.objectContaining({ orderStatus: ["REJECTED"], timeRange: "LAST_WEEK" }));
    expect(printItemsMock).toHaveBeenCalledTimes(1);
    const [orders, filters] = printItemsMock.mock.calls[0];
    expect(orders).toHaveLength(386);
    expect(filters).toEqual(expect.objectContaining({ status: "REJECTED", timeRange: "LAST_WEEK" }));
  });

  it("prints nothing when loading failed", async () => {
    loadAllMock.mockResolvedValue(null);
    render(<OrderHistory />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await click(printButton());
    expect(printItemsMock).not.toHaveBeenCalled();
  });

  it("both buttons are disabled while one is working, so a double click cannot run twice", async () => {
    let finish: (v: Order[]) => void = () => {};
    loadAllMock.mockReturnValue(new Promise<Order[]>((r) => { finish = r; }));
    render(<OrderHistory />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    fireEvent.click(printButton());
    expect(printButton().disabled).toBe(true);
    expect(exportButton().disabled).toBe(true);
    fireEvent.click(printButton());
    fireEvent.click(exportButton());
    expect(loadAllMock).toHaveBeenCalledTimes(1);
    await act(async () => { finish(ALL_ORDERS); });
    expect(printItemsMock).toHaveBeenCalledTimes(1);
    expect(printButton().disabled).toBe(false);
  });

  it.each([
    ["loading", { isLoading: true, data: [] }],
    ["refreshing / filter change in flight", { isFetching: true }],
    ["the request failed", { isError: true }],
    ["there are no orders", { data: [] }],
  ])("is disabled while %s", async (_label, over) => {
    queryMock.mockReturnValue(queryResult(over));
    render(<OrderHistory />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(printButton().disabled).toBe(true);
    await click(printButton());
    expect(loadAllMock).not.toHaveBeenCalled();
  });
});
