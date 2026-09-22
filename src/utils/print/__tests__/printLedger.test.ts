import { act, cleanup, renderHook } from "@testing-library/react";
import { toast } from "react-hot-toast";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrintOrder } from "../../../hooks/usePrintOrder";
import type { Order } from "../../../types/order";
import { PRINT_TIMEOUT_MS, printTextDetailed, savePrinterSettings } from "../printAgent";
import {
  claimPrint,
  clearPrinted,
  getOrderStamp,
  markPrinted,
  pruneLedger,
  releasePrint,
  setOrderStamp,
  wasPrinted,
} from "../printLedger";

// usePrintOrder's toasts are the whole point of N2 — real react-hot-toast has
// no listener mounted in these tests, so the calls themselves are the assertion.
vi.mock("react-hot-toast", () => {
  const fn = vi.fn() as unknown as { (msg: string, opts?: unknown): void } & Record<string, ReturnType<typeof vi.fn>>;
  fn.success = vi.fn();
  fn.error = vi.fn();
  return { toast: fn, default: fn };
});

// A minimal Storage-shaped fake that can be made to throw on demand, so we
// can prove the ledger survives a real QuotaExceededError instead of just
// asserting on values that were never actually written through setItem.
interface FakeStorageOptions {
  initial?: Record<string, string>;
  failSetItemTimes?: number; // throw on the first N setItem calls
  failGetItem?: boolean;
}

const quotaError = () => {
  const err = new Error("The quota has been exceeded.");
  err.name = "QuotaExceededError";
  return err;
};

const createFakeStorage = (opts: FakeStorageOptions = {}) => {
  const data = new Map<string, string>(Object.entries(opts.initial ?? {}));
  let setItemCalls = 0;

  return {
    getItem: vi.fn((key: string): string | null => {
      if (opts.failGetItem) throw new Error("getItem blocked");
      return data.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string): void => {
      setItemCalls++;
      if (opts.failSetItemTimes && setItemCalls <= opts.failSetItemTimes) {
        throw quotaError();
      }
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string): void => {
      data.delete(key);
    }),
    key: vi.fn((index: number): string | null => Array.from(data.keys())[index] ?? null),
    get length(): number {
      return data.size;
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("printLedger", () => {
  it("TC1: markPrinted then wasPrinted is true; an unmarked order is false", () => {
    vi.stubGlobal("sessionStorage", createFakeStorage());

    markPrinted("A");

    expect(wasPrinted("A")).toBe(true);
    expect(wasPrinted("B")).toBe(false);
  });

  it("TC2: clearPrinted un-marks a previously printed order", () => {
    vi.stubGlobal("sessionStorage", createFakeStorage());

    markPrinted("A");
    clearPrinted("A");

    expect(wasPrinted("A")).toBe(false);
  });

  it("TC3: setOrderStamp round-trips through getOrderStamp; a missing stamp is null", () => {
    vi.stubGlobal("sessionStorage", createFakeStorage());
    const iso = "2026-09-20T12:30:00.000Z";

    setOrderStamp("A", "acceptedAt", iso);

    expect(getOrderStamp("A", "acceptedAt")).toBe(iso);
    expect(getOrderStamp("B", "acceptedAt")).toBeNull();
  });

  it("TC4 (QUOTA): a setItem that always throws QuotaExceededError never escapes markPrinted/setOrderStamp", () => {
    const storage = createFakeStorage({ failSetItemTimes: Infinity });
    vi.stubGlobal("sessionStorage", storage);

    expect(() => markPrinted("A")).not.toThrow();
    // Proves this genuinely exercised a throwing setItem, not a no-op: one
    // initial attempt plus one retry after the internal prune, both of which
    // actually threw.
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(storage.setItem.mock.results.every((r) => r.type === "throw")).toBe(true);

    storage.setItem.mockClear();
    expect(() => setOrderStamp("A", "acceptedAt", "2026-09-20T12:30:00.000Z")).not.toThrow();
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(storage.setItem.mock.results.every((r) => r.type === "throw")).toBe(true);

    // Nothing was ever actually persisted — confirms the throws were real.
    expect(wasPrinted("A")).toBe(false);
    expect(getOrderStamp("A", "acceptedAt")).toBeNull();
  });

  it("TC5 (quota recovery): a setItem that throws once succeeds on the retry after a prune", () => {
    const storage = createFakeStorage({ failSetItemTimes: 1 });
    vi.stubGlobal("sessionStorage", storage);

    setOrderStamp("A", "acceptedAt", "2026-09-20T12:30:00.000Z");

    expect(getOrderStamp("A", "acceptedAt")).toBe("2026-09-20T12:30:00.000Z");
    expect(storage.setItem).toHaveBeenCalledTimes(2); // fails once, retries once — not a loop
  });

  it("TC6 (read failure): a getItem that throws makes wasPrinted false and getOrderStamp null, neither throws", () => {
    vi.stubGlobal("sessionStorage", createFakeStorage({ failGetItem: true }));

    expect(() => wasPrinted("A")).not.toThrow();
    expect(wasPrinted("A")).toBe(false);
    expect(() => getOrderStamp("A", "acceptedAt")).not.toThrow();
    expect(getOrderStamp("A", "acceptedAt")).toBeNull();
  });

  it("TC7 (prune): pruning 500 stamped keys down to 400 drops the oldest and keeps the newest", () => {
    const initial: Record<string, string> = {};
    for (let i = 0; i < 500; i++) {
      // Strictly increasing timestamps: order 0 is oldest, order 499 newest.
      initial[`order_ORD-${i}_acceptedAt`] = new Date(2026, 0, 1, 0, 0, i).toISOString();
    }
    vi.stubGlobal("sessionStorage", createFakeStorage({ initial }));

    const removed = pruneLedger(400);

    expect(removed).toBe(100);
    expect(getOrderStamp("ORD-0", "acceptedAt")).toBeNull(); // oldest — pruned
    expect(getOrderStamp("ORD-499", "acceptedAt")).not.toBeNull(); // newest — survives
  });

  it("TC8 (prune is safe): pruning empty storage returns 0 and does not throw", () => {
    vi.stubGlobal("sessionStorage", createFakeStorage());

    expect(() => pruneLedger(400)).not.toThrow();
    expect(pruneLedger(400)).toBe(0);
  });

  it("TC9 (no collateral): pruning never removes unrelated keys", () => {
    const initial: Record<string, string> = {
      qv_counter_printer: "EPSON TM-T82X Receipt",
      qv_agent_port: "1818",
      vendorName: "Test Vendor",
      "quickverse-auth-store": '{"token":"abc"}',
    };
    for (let i = 0; i < 10; i++) {
      initial[`order_ORD-${i}_acceptedAt`] = new Date(2026, 0, 1, 0, 0, i).toISOString();
    }
    const storage = createFakeStorage({ initial });
    vi.stubGlobal("sessionStorage", storage);

    pruneLedger(0); // force removal of every ledger-family key

    expect(storage.getItem("qv_counter_printer")).toBe("EPSON TM-T82X Receipt");
    expect(storage.getItem("qv_agent_port")).toBe("1818");
    expect(storage.getItem("vendorName")).toBe("Test Vendor");
    expect(storage.getItem("quickverse-auth-store")).toBe('{"token":"abc"}');
  });

  it("TC10 (key compatibility): legacy keys written directly are read correctly through the ledger API", () => {
    const iso = "2026-09-20T12:30:00.000Z";
    vi.stubGlobal(
      "sessionStorage",
      createFakeStorage({
        initial: {
          qv_printed_LEGACY1: "1",
          order_LEGACY1_acceptedAt: iso,
        },
      })
    );

    expect(wasPrinted("LEGACY1")).toBe(true);
    expect(getOrderStamp("LEGACY1", "acceptedAt")).toBe(iso);
  });
});

// PLAN.md's frozen print-idempotency contract, and the test its risk matrix names
// for AC5/R3. The check-then-act that shipped instead (wasPrinted, two awaits,
// then markPrinted) leaves the flag unwritten across both agent round-trips.
describe("printLedger claim/release — concurrent claim yields exactly one", () => {
  it("TC11: two claimPrint calls for one orderId in the SAME tick yield exactly one true", () => {
    vi.stubGlobal("sessionStorage", createFakeStorage());

    // No await between them: this is the whole window the contract has to close.
    const results = [claimPrint("QV-1"), claimPrint("QV-1")];

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[0]).toBe(true);
    expect(wasPrinted("QV-1")).toBe(true);
  });

  it("TC12: claimPrint marks the order before it returns, so a later claim is refused", () => {
    vi.stubGlobal("sessionStorage", createFakeStorage());

    expect(claimPrint("QV-1")).toBe(true);
    expect(claimPrint("QV-1")).toBe(false);
    expect(claimPrint("QV-2")).toBe(true);
  });

  it("TC13 (R3): releasePrint permits a later claim, so Reprint works after a total failure", () => {
    vi.stubGlobal("sessionStorage", createFakeStorage());

    claimPrint("QV-1");
    releasePrint("QV-1");

    expect(wasPrinted("QV-1")).toBe(false);
    expect(claimPrint("QV-1")).toBe(true);
  });

  it("TC14 (quota-safe): a storage that always throws never lets claimPrint throw", () => {
    vi.stubGlobal("sessionStorage", createFakeStorage({ failSetItemTimes: Infinity }));

    expect(() => claimPrint("QV-1")).not.toThrow();
    expect(() => releasePrint("QV-1")).not.toThrow();
  });
});

// ─── C3: the client's own timeout must not manufacture a duplicate bill ───
// Lives in this file because the two halves are one failure: an abort that routes
// into the browser fallback also marks the order printed, so the staff confirm a
// second copy of a bill the agent is still printing.

describe("printAgent timeout budget vs the agent's own bounds", () => {
  const abortError = () =>
    Object.assign(new Error("The operation was aborted."), { name: "AbortError" });

  // jsdom's window.open is a no-op returning null, which would make printViaBrowser
  // report failure for the wrong reason and hide the bug. A fake window makes the
  // fallback genuinely "succeed", exactly as it does on a vendor PC.
  const stubWindowOpen = () => {
    const openSpy = vi.fn(() => ({ document: { write: vi.fn(), close: vi.fn() } }));
    vi.stubGlobal("open", openSpy);
    return openSpy;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("TC-C3 (THE BUG): an aborted POST /print reports failed and never opens the browser window", async () => {
    const openSpy = stubWindowOpen();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(abortError())));

    const out = await printTextDetailed("counter", "BILL TEXT");

    expect(out.where).toBe("failed");
    expect(openSpy).not.toHaveBeenCalled();
    // Staff must be told to look at the printer, not handed a second copy to confirm.
    expect(out.error).toMatch(/check the printer/i);
  });

  it("TC-C3b: a genuine connection failure still falls back to the browser", async () => {
    const openSpy = stubWindowOpen();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));

    const out = await printTextDetailed("counter", "BILL TEXT");

    expect(out.where).toBe("browser");
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it("TC-C3c: the POST /print budget exceeds the agent's bounded worst case", () => {
    // agent.ps1: $PrinterCallTimeoutMs = 3000 bounds the spooler call, $doc.Print()
    // is unbounded past it, and the listener's EntityBody ceiling is 15s.
    expect(PRINT_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
  });
});

// ─── N2/N4: usePrintOrder.printBothOnAccept — partial outcomes must never
// claim a browser window opened when none did, and the print-idempotency
// claim must run before either print is attempted, not just before the
// ledger flag is read elsewhere. ───

const makeOrder = (orderId: string): Order => ({
  orderId,
  campusId: "CAMPUS-1",
  shopId: 1,
  customerId: 1001,
  customerName: "Rahul Sharma",
  customerMobile: 9876543210,
  customerAddress: "Hostel Block A, Near Gate 2",
  state: "ACCEPTED",
  creationTime: "2026-09-20 12:30:00",
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
  stateLabel: "Accepted",
  orderDescription: "",
  orderLink: "",
  paymentMethod: "Online",
  isSettled: false,
});

describe("usePrintOrder.printBothOnAccept — partial outcomes and claim ordering", () => {
  const abortError = () =>
    Object.assign(new Error("The operation was aborted."), { name: "AbortError" });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("TC-N2a: bill succeeds + KOT times out — names the failed slip, never claims a window opened", async () => {
    vi.stubGlobal("sessionStorage", createFakeStorage());
    savePrinterSettings({ counterPrinter: "Counter1", kitchenPrinter: "Kitchen1", agentPort: 1818 });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: { body: string }) => {
        const { printer } = JSON.parse(init.body);
        if (printer === "Kitchen1") return Promise.reject(abortError());
        return Promise.resolve({ ok: true } as Response);
      })
    );

    const { result } = renderHook(() => usePrintOrder());

    await act(async () => {
      await result.current.printBothOnAccept(makeOrder("QV-N2A"), 15);
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    const message = (toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(message).toMatch(/KOT/);
    expect(message).not.toMatch(/window opened/i);
    // The bare toast(...) callable is ONLY ever used for "window opened" — it
    // must not have fired at all on a run where no window opened.
    expect(toast).not.toHaveBeenCalled();
  });

  it("TC-N2b: both slips open a real browser window — the window-opened message IS still used", async () => {
    vi.stubGlobal("sessionStorage", createFakeStorage());
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    vi.stubGlobal("open", vi.fn(() => ({ document: { write: vi.fn(), close: vi.fn() } })));

    const { result } = renderHook(() => usePrintOrder());

    await act(async () => {
      await result.current.printBothOnAccept(makeOrder("QV-N2B"), 15);
    });

    expect(toast).toHaveBeenCalledWith("Print window opened — confirm to print", { icon: "🖨️" });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("TC-N4: two concurrent accepts for the SAME order attempt exactly one print", async () => {
    vi.stubGlobal("sessionStorage", createFakeStorage());
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePrintOrder());
    const order = makeOrder("QV-RACE");

    await act(async () => {
      const p1 = result.current.printBothOnAccept(order, 15);
      const p2 = result.current.printBothOnAccept(order, 15);
      await Promise.all([p1, p2]);
    });

    // Bill + KOT for ONE call = 2 requests. If claimPrint ever moved below the
    // Promise.all, both concurrent calls would print — 4 requests, not 2.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// I10: the Accepted card's "Print Bill + KOT" clears its marker only when this
// resolves true, so it must be false whenever any slip failed.
describe("usePrintOrder.reprint — reports whether every slip got out", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
  });

  const run = async (fail: string | null) => {
    vi.stubGlobal("sessionStorage", createFakeStorage());
    savePrinterSettings({ counterPrinter: "Counter1", kitchenPrinter: "Kitchen1", agentPort: 1818 });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: { body: string }) => {
        const { printer } = JSON.parse(init.body);
        if (printer === fail) return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("print failed: jam") } as Response);
        return Promise.resolve({ ok: true } as Response);
      })
    );
    const { result } = renderHook(() => usePrintOrder());
    let out: boolean | undefined;
    await act(async () => {
      out = await result.current.reprint(makeOrder("QV-RP"), "both");
    });
    return out;
  };

  it("TC-RP1: both slips out → true", async () => {
    expect(await run(null)).toBe(true);
  });

  it("TC-RP2: KOT failed → false", async () => {
    expect(await run("Kitchen1")).toBe(false);
  });
});
