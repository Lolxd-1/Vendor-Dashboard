// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import api from "../index";
import { toVendorOrdersPage, type OrderFilterParams } from "../orderApi";
import { OrderStatusFilter, TimeFilterOption } from "../../types/filters";

// The API base comes from VITE_API_URL in a local .env that is not in the repo. Pin it to a
// reserved .test host (never resolves) so these tests don't depend on .env and can't reach a server.
vi.hoisted(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/");
});

// Runs the real endpoints through a real store; only the network is faked.
let requested: URL[] = [];
const backendBody = { response: { orders: [{ orderId: "1" }, { orderId: "2" }], currentPage: 0, totalPages: 8, totalElements: 386 } };

const makeStore = () =>
  configureStore({
    reducer: { [api.reducerPath]: api.reducer },
    middleware: (gdm) => gdm().concat(api.middleware),
  });

beforeEach(() => {
  requested = [];
  vi.stubGlobal("fetch", vi.fn(async (input: Request | string) => {
    requested.push(new URL(typeof input === "string" ? input : input.url));
    return new Response(JSON.stringify(backendBody), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const endpoints = (api as any).endpoints;

const callList = async (args: OrderFilterParams) => {
  const store = makeStore();
  return store.dispatch(endpoints.getVendorOrders.initiate(args)).unwrap();
};
const callPage = async (args: OrderFilterParams & { page: number }) => {
  const store = makeStore();
  return store.dispatch(endpoints.getVendorOrdersPage.initiate(args)).unwrap();
};

describe("getVendorOrders (the Order History table) — request unchanged", () => {
  it("no filter: plain URL, no query string", async () => {
    const data = await callList({ shopId: "68246" });
    expect(requested[0].pathname).toBe("/quickVerse/v2/order/68246/orders");
    expect(requested[0].search).toBe("");
    expect(data).toEqual(backendBody.response.orders); // still returns just the orders array
  });

  it("status + time period", async () => {
    await callList({ shopId: "68246", orderStatus: [OrderStatusFilter.COMPLETED], timeRange: TimeFilterOption.LAST_WEEK });
    expect(requested[0].searchParams.getAll("orderStatus")).toEqual(["COMPLETED"]);
    expect(requested[0].searchParams.get("timeRange")).toBe("LAST_WEEK");
    expect(requested[0].searchParams.has("page")).toBe(false);
  });

  it("custom dates are sent only with CUSTOM", async () => {
    await callList({ shopId: "1", timeRange: TimeFilterOption.CUSTOM, fromTime: "2026-04-27T00:00:00", toTime: "2026-05-03T23:59:59" });
    expect(requested[0].searchParams.get("fromTime")).toBe("2026-04-27T00:00:00");
    expect(requested[0].searchParams.get("toTime")).toBe("2026-05-03T23:59:59");

    await callList({ shopId: "2", timeRange: TimeFilterOption.TODAY, fromTime: "x", toTime: "y" });
    expect(requested[1].searchParams.has("fromTime")).toBe(false);
    expect(requested[1].searchParams.has("toTime")).toBe(false);
  });
});

describe("getVendorOrdersPage (Export / Print Items)", () => {
  it("sends the same filters plus the page number, and returns the page count", async () => {
    const res = await callPage({
      shopId: "68246",
      orderStatus: [OrderStatusFilter.REJECTED],
      timeRange: TimeFilterOption.CUSTOM,
      fromTime: "2026-04-27T00:00:00",
      toTime: "2026-05-03T23:59:59",
      page: 3,
    });
    const q = requested[0].searchParams;
    expect(requested[0].pathname).toBe("/quickVerse/v2/order/68246/orders");
    expect(q.getAll("orderStatus")).toEqual(["REJECTED"]);
    expect(q.get("timeRange")).toBe("CUSTOM");
    expect(q.get("fromTime")).toBe("2026-04-27T00:00:00");
    expect(q.get("toTime")).toBe("2026-05-03T23:59:59");
    expect(q.get("page")).toBe("3");
    expect(res).toEqual({ orders: backendBody.response.orders, totalPages: 8 });
  });

  it("works with no filters (page only)", async () => {
    await callPage({ shopId: "68246", page: 0 });
    expect(requested[0].search).toBe("?page=0");
  });
});

describe("toVendorOrdersPage", () => {
  it("tolerates a missing or odd response", () => {
    expect(toVendorOrdersPage({})).toEqual({ orders: [], totalPages: 0 });
    expect(toVendorOrdersPage({ response: { orders: [], totalPages: undefined } })).toEqual({ orders: [], totalPages: 0 });
  });
});
