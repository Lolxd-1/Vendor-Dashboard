import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { triggerMock, toastMock } = vi.hoisted(() => ({
  triggerMock: vi.fn(),
  toastMock: { loading: vi.fn(() => "t1"), dismiss: vi.fn(), error: vi.fn() },
}));
vi.mock("../../apis/orderApi", () => ({ useLazyGetVendorOrdersPageQuery: () => [triggerMock] }));
vi.mock("react-hot-toast", () => ({ default: toastMock }));

import { useLoadAllOrders } from "../useLoadAllOrders";

const pageOf = (page: number, totalPages: number) => ({
  unwrap: () => Promise.resolve({ orders: [{ orderId: `P${page}` }], totalPages }),
});

beforeEach(() => {
  triggerMock.mockReset();
  Object.values(toastMock).forEach((f) => f.mockClear());
});

describe("useLoadAllOrders", () => {
  it("asks for every page with the page's filters and shows progress", async () => {
    triggerMock.mockImplementation((args: { page: number }) => pageOf(args.page, 3));
    const { result } = renderHook(() => useLoadAllOrders());
    const params = { shopId: "68246", timeRange: undefined };
    const orders = await result.current(params);

    expect(orders?.map((o) => o.orderId)).toEqual(["P0", "P1", "P2"]);
    expect(triggerMock.mock.calls.map((c) => c[0])).toEqual([
      { ...params, page: 0 },
      { ...params, page: 1 },
      { ...params, page: 2 },
    ]);
    expect(toastMock.loading).toHaveBeenCalledWith("Loading orders 3/3…", { id: "t1" });
    expect(toastMock.dismiss).toHaveBeenCalledWith("t1");
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("returns null and explains when a page fails (nothing gets exported/printed)", async () => {
    triggerMock.mockImplementation((args: { page: number }) =>
      args.page === 1 ? { unwrap: () => Promise.reject({ status: 500, data: "boom" }) } : pageOf(args.page, 3)
    );
    const { result } = renderHook(() => useLoadAllOrders());
    expect(await result.current({ shopId: "68246" })).toBeNull();
    expect(toastMock.error).toHaveBeenCalledWith(
      "Couldn't load all orders: network or server error. Nothing was exported or printed.",
      { id: "t1", duration: 6000 }
    );
  });
});
