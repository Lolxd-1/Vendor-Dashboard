import type { IFrame, StompConfig } from "@stomp/stompjs";
import { act, cleanup, renderHook } from "@testing-library/react";
import { toast } from "react-hot-toast";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import indexHtmlSource from "../../../index.html?raw";
import dashboardLayoutSource from "../../Layout/Dashboardlayout.tsx?raw";
import { useAuthStore } from "../../stores/useAuthStore";
import { TERMINAL_STATES, useDashboardStore } from "../../stores/useDashboardStore";
import type { Order } from "../../types/order";
import { wasAcceptUnconfirmed } from "../../utils/print/printLedger";
import { FAST_MS, SLOW_MS, pickInterval } from "../useOrderSync";
import { usePendingOrder } from "../usePendingOrders";
import {
  PROMPT_MAX_MS,
  isPromptFrame,
  stompDebug,
  useOrderWebsocket,
} from "../useOrderWebsocket";
import hookSource from "../useOrderWebsocket.tsx?raw";

// A fake STOMP Client: captures the config passed to `new Client(...)` (debug/onConnect/etc.)
// and the subscribe callback, without ever opening a real socket. `activate()` is a no-op, so
// `webSocketFactory` (which would build a real SockJS instance) is never invoked.
vi.mock("@stomp/stompjs", () => {
  class FakeStompClient {
    static instances: FakeStompClient[] = [];
    config: StompConfig;
    messageHandler: ((message: { body: string }) => void) | null = null;

    constructor(config: StompConfig) {
      this.config = config;
      FakeStompClient.instances.push(this);
    }
    activate() {}
    deactivate() {}
    subscribe(_topic: string, cb: (message: { body: string }) => void) {
      this.messageHandler = cb;
      return { id: "sub-0", unsubscribe() {} };
    }
  }
  return { Client: FakeStompClient };
});

// usePendingOrder's two process boundaries: the accept mutation and the printer.
const { acceptOrderMock, printBothOnAcceptMock } = vi.hoisted(() => ({
  acceptOrderMock: vi.fn(),
  printBothOnAcceptMock: vi.fn(),
}));

vi.mock("../../apis/dashboardApi", () => ({
  useAcceptOrderMutation: () => [acceptOrderMock, { isLoading: false }],
  useRejectOrderMutation: () => [vi.fn(), { isLoading: false }],
}));

vi.mock("../usePrintOrder", () => ({
  usePrintOrder: () => ({ printBothOnAccept: printBothOnAcceptMock }),
}));

import { Client } from "@stomp/stompjs";
const FakeClient = Client as unknown as {
  instances: Array<{
    config: StompConfig;
    messageHandler: ((message: { body: string }) => void) | null;
  }>;
};

// onConnect's real signature takes the broker's CONNECTED frame; these tests only care that the
// callback runs, so a stub satisfies the type without asserting on frame content.
const fakeFrame = {} as IFrame;

const nowSeconds = () => Math.floor(Date.now() / 1000);
const base64UrlEncode = (value: unknown): string =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const makeToken = (payload: unknown): string =>
  `${base64UrlEncode({ alg: "HS256", typ: "JWT" })}.${base64UrlEncode(payload)}.signature`;

const originalClearSession = useAuthStore.getState().clearSession;

beforeEach(() => {
  FakeClient.instances.length = 0;
  useDashboardStore.getState().clearAll();
  useAuthStore.setState({
    isAuthenticated: false,
    jwt: null,
    shopId: null,
    phone: null,
    clearSession: originalClearSession,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("stompDebug — STOMP debug gate", () => {
  it("TC1: does not log in a production build (DEV=false)", () => {
    vi.stubEnv("DEV", false);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    stompDebug(">>> CONNECT\nAuthorization:Bearer some.jwt.token\n\n\0");

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("TC2: still logs in dev (DEV=true)", () => {
    vi.stubEnv("DEV", true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    stompDebug("hello frame");

    expect(logSpy).toHaveBeenCalledWith("STOMP:", "hello frame");
  });
});

describe("window title consistency", () => {
  it("TC3: index.html <title> and Dashboardlayout BASE_TITLE match and are not the old typo", () => {
    const titleMatch = indexHtmlSource.match(/<title>([^<]*)<\/title>/);
    const baseTitleMatch = dashboardLayoutSource.match(/const BASE_TITLE = "([^"]*)"/);

    expect(titleMatch).not.toBeNull();
    expect(baseTitleMatch).not.toBeNull();
    expect(titleMatch![1]).toBe(baseTitleMatch![1]);
    expect(titleMatch![1].toLowerCase()).not.toContain("dashborad");
  });
});

describe("no content/PII logging remains", () => {
  it("TC4: no console.log call takes message.body or the parsed data object as an argument", () => {
    const consoleLogCalls = hookSource.match(/console\.log\([^;]*\);/g) ?? [];
    // Sanity check on the regex itself: lifecycle logs are still expected to remain.
    expect(consoleLogCalls.length).toBeGreaterThan(0);

    for (const call of consoleLogCalls) {
      expect(call).not.toMatch(/\bmessage\.body\b/);
      expect(call).not.toMatch(/[(,]\s*data\s*[,)]/);
    }
  });
});

describe("phase parsing standardised on `||` (T03 handoff)", () => {
  it("an empty-string status with state ACCEPTED is treated as ACCEPTED, not ignored", () => {
    const token = makeToken({ exp: nowSeconds() + 3600 });
    useAuthStore.setState({ jwt: token, shopId: "SHOP-1" });
    // Held locally first: a status-only frame may move a known order, never insert one (#11).
    useDashboardStore.getState().addPendingOrder({ orderId: "QV-EMPTY-STATUS" } as Order);

    renderHook(() => useOrderWebsocket());
    const instance = FakeClient.instances[FakeClient.instances.length - 1];

    act(() => {
      instance.config.onConnect!(fakeFrame);
    });
    act(() => {
      instance.messageHandler!({
        body: JSON.stringify({ orderId: "QV-EMPTY-STATUS", status: "", state: "ACCEPTED" }),
      });
    });

    const { acceptedOrders, pendingOrders } = useDashboardStore.getState();
    expect(acceptedOrders.some((o) => o.orderId === "QV-EMPTY-STATUS")).toBe(true);
    expect(pendingOrders.some((o) => o.orderId === "QV-EMPTY-STATUS")).toBe(false);
  });
});

describe("idle-tab expiry surfaces the session-expired toast (T04 handoff)", () => {
  it("notifies exactly once, reusing the socket path's once-only guard and message", () => {
    vi.useFakeTimers();

    // Not expired at mount (isTokenExpired's default 30s skew needs exp*1000 <= now+30000,
    // and +40s keeps it comfortably above that), but expired by the time the 60s idle
    // interval's first tick checks it again.
    const token = makeToken({ exp: nowSeconds() + 40 });
    const clearSessionSpy = vi.fn();
    useAuthStore.setState({ jwt: token, shopId: "SHOP-1", clearSession: clearSessionSpy });
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "mock-id");

    renderHook(() => useOrderWebsocket());

    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(toastErrorSpy).toHaveBeenCalledTimes(1);
    expect(toastErrorSpy).toHaveBeenCalledWith("Session expired - please log in again");
    expect(clearSessionSpy).toHaveBeenCalledTimes(1);

    // A second tick must not show it again.
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(toastErrorSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── Round 1: the rate must key off PROMPT delivery, not delivery ───
// A frame that took ~27s through the buffered Vercel long-poll is evidence the socket is
// DEGRADED. Counting it as evidence earned the slow REST rate for the very socket that
// caused the 30s complaint, so promptness is now a precondition for stamping lastMessageAt.

describe("isPromptFrame — only a promptly-delivered frame is evidence", () => {
  const now = 1_700_000_000_000;
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  it("a frame 1s old is prompt", () => {
    expect(isPromptFrame({ creationTime: at(-1_000) }, now)).toBe(true);
  });

  it("a frame 27s old is NOT prompt — this is the Vercel case", () => {
    expect(isPromptFrame({ creationTime: at(-27_000) }, now)).toBe(false);
  });

  it("exactly PROMPT_MAX_MS old is NOT prompt (boundary)", () => {
    expect(isPromptFrame({ creationTime: at(-PROMPT_MAX_MS) }, now)).toBe(false);
  });

  it("a missing creationTime is NOT prompt (fail-safe toward the fast rate)", () => {
    expect(isPromptFrame({ orderId: "QV-1" }, now)).toBe(false);
  });

  it("an unparseable creationTime is NOT prompt", () => {
    expect(isPromptFrame({ creationTime: "not-a-date" }, now)).toBe(false);
  });

  it("a null frame and a non-object frame are NOT prompt", () => {
    expect(isPromptFrame(null, now)).toBe(false);
    expect(isPromptFrame(42, now)).toBe(false);
  });

  it("2s in the future is still prompt (minor clock skew)", () => {
    expect(isPromptFrame({ creationTime: at(2_000) }, now)).toBe(true);
  });

  it("5 minutes in the future is NOT prompt (broken clock, do not trust it)", () => {
    expect(isPromptFrame({ creationTime: at(300_000) }, now)).toBe(false);
  });
});

describe("lastMessageAt is stamped only by a prompt frame", () => {
  const connectHook = () => {
    const token = makeToken({ exp: nowSeconds() + 3600 });
    useAuthStore.setState({ jwt: token, shopId: "SHOP-1" });

    const { result } = renderHook(() => useOrderWebsocket());
    const instance = FakeClient.instances[FakeClient.instances.length - 1];
    act(() => {
      instance.config.onConnect!(fakeFrame);
    });
    return { result, instance };
  };

  // PENDING moves the order into a column without raising a toast, so these tests
  // exercise the stamp without asserting on unrelated notification behaviour.
  const frame = (orderId: string, ageMs: number) => ({
    body: JSON.stringify({
      orderId,
      status: "PENDING",
      creationTime: new Date(Date.now() - ageMs).toISOString(),
    }),
  });

  it("a frame 1s old stamps lastMessageAt", () => {
    const { result, instance } = connectHook();

    act(() => {
      instance.messageHandler!(frame("QV-PROMPT", 1_000));
    });

    expect(result.current.lastMessageAt).not.toBeNull();
  });

  it("a frame 27s old does NOT stamp lastMessageAt", () => {
    const { result, instance } = connectHook();

    act(() => {
      instance.messageHandler!(frame("QV-LATE", 27_000));
    });

    expect(result.current.lastMessageAt).toBeNull();
  });

  it("a malformed frame does not stamp and does not throw", () => {
    const { result, instance } = connectHook();

    act(() => {
      instance.messageHandler!({ body: "}{ not json" });
    });

    expect(result.current.lastMessageAt).toBeNull();
  });

  it("a healthy socket still earns the slow rate — promptness is not a blanket disable", () => {
    const { result, instance } = connectHook();

    act(() => {
      instance.messageHandler!(frame("QV-HEALTHY", 1_000));
    });

    expect(pickInterval(result.current, Date.now())).toBe(SLOW_MS);
  });

  it("THE SCENARIO: a shop fed only late frames never earns the slow rate", () => {
    vi.useFakeTimers();
    const { result, instance } = connectHook();

    // Three orders over 90s, each delivered ~27s after it was created — the measured
    // Vercel band. The socket is connected and genuinely delivering the whole time.
    for (let i = 0; i < 3; i++) {
      act(() => {
        instance.messageHandler!(frame(`QV-LATE-${i}`, 27_000));
      });

      expect(result.current.lastMessageAt).toBeNull();
      expect(pickInterval(result.current, Date.now())).toBe(FAST_MS);

      act(() => {
        vi.advanceTimersByTime(30_000);
      });
    }

    // Still fast after 90s of steady late traffic, so worst-case order latency stays
    // bounded by FAST_MS instead of drifting back to the ~30s the vendor reported.
    expect(pickInterval(result.current, Date.now())).toBe(FAST_MS);
    expect(FAST_MS).toBeLessThanOrEqual(10_000);
  });
});

// ─── I8: no logout is ever unexplained ───
// Two expiry paths were built and only one was fixed. The mount-time check runs
// before the socket is even attempted and trusts Date.now() alone, so a shop PC
// with a fast clock (dead CMOS battery, no NTP) gets login -> bounce -> login
// with nothing on screen to explain it.

describe("mount-time expiry surfaces the same toast (I8)", () => {
  it("TC-I8: an already-expired token at mount clears the session and notifies exactly once", () => {
    vi.useFakeTimers();

    const token = makeToken({ exp: nowSeconds() - 60 });
    const clearSessionSpy = vi.fn();
    useAuthStore.setState({ jwt: token, shopId: "SHOP-1", clearSession: clearSessionSpy });
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "mock-id");

    renderHook(() => useOrderWebsocket());

    expect(clearSessionSpy).toHaveBeenCalledTimes(1);
    expect(toastErrorSpy).toHaveBeenCalledTimes(1);
    expect(toastErrorSpy).toHaveBeenCalledWith("Session expired - please log in again");

    // The dead token must not open a socket either.
    expect(FakeClient.instances).toHaveLength(0);

    // No later path may notify a second time for the same mount.
    act(() => {
      vi.advanceTimersByTime(180000);
    });
    expect(toastErrorSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── #11 + terminal-set wiring: what a socket frame may do to the board ───

describe("socket frames: phantom inserts and the shared terminal set", () => {
  const connect = () => {
    const token = makeToken({ exp: nowSeconds() + 3600 });
    useAuthStore.setState({ jwt: token, shopId: "SHOP-1" });
    renderHook(() => useOrderWebsocket());
    const instance = FakeClient.instances[FakeClient.instances.length - 1];
    act(() => {
      instance.config.onConnect!(fakeFrame);
    });
    return (payload: unknown) =>
      act(() => {
        instance.messageHandler!({ body: JSON.stringify(payload) });
      });
  };
  const allIds = () => {
    const { pendingOrders, acceptedOrders, readyOrders } = useDashboardStore.getState();
    return [...pendingOrders, ...acceptedOrders, ...readyOrders].map((o) => o.orderId);
  };

  it("TC-11a: a status-only PENDING frame for an unknown order inserts no card (no phantom ring)", () => {
    const send = connect();
    send({ orderId: "QV-PHANTOM", status: "PENDING" });
    expect(allIds()).not.toContain("QV-PHANTOM");
  });

  it("TC-11b: the same holds for ACCEPTED / READY_FOR_PICKUP — no blank card to reprint", () => {
    const send = connect();
    send({ orderId: "QV-PHANTOM-A", status: "ACCEPTED" });
    send({ orderId: "QV-PHANTOM-R", status: "READY_FOR_PICKUP" });
    expect(allIds()).toEqual([]);
  });

  it("TC-11c: a full order carrying a phase is still inserted", () => {
    const send = connect();
    send({ orderId: "QV-FULL", status: "PENDING", orderItem: [{ name: "Tea", itemCount: 1 }] });
    expect(useDashboardStore.getState().pendingOrders.map((o) => o.orderId)).toEqual(["QV-FULL"]);
  });

  it("TC-11d: a status-only frame still moves an order this device already holds", () => {
    useDashboardStore.getState().addPendingOrder({ orderId: "QV-HELD" } as Order);
    const send = connect();
    send({ orderId: "QV-HELD", status: "ACCEPTED" });
    const { pendingOrders, acceptedOrders } = useDashboardStore.getState();
    expect(pendingOrders).toHaveLength(0);
    expect(acceptedOrders.map((o) => o.orderId)).toEqual(["QV-HELD"]);
  });

  it("TC-T1: every state in TERMINAL_STATES drops the card over the socket, whatever its casing", () => {
    vi.spyOn(toast, "error").mockImplementation(() => "mock-id");
    vi.spyOn(toast, "success").mockImplementation(() => "mock-id");
    const send = connect();

    for (const state of TERMINAL_STATES) {
      for (const spelling of [state, ` ${state.toLowerCase()} `]) {
        useDashboardStore.getState().addPendingOrder({ orderId: "QV-T" } as Order);
        send({ orderId: "QV-T", status: spelling });
        expect(allIds(), `${JSON.stringify(spelling)} should drop the order`).toEqual([]);
      }
    }
  });

  it("TC-T2: a lower-case terminal frame that carries items is dropped, never added as a new order", () => {
    vi.spyOn(toast, "error").mockImplementation(() => "mock-id");
    const send = connect();
    send({ orderId: "QV-GONE", status: "cancelled", orderItem: [{ name: "Tea", itemCount: 1 }] });
    expect(allIds()).toEqual([]);
  });
});

// ─── I10: an accept that fails on the wire may already have committed ───

describe("a failed accept never looks like a clean failure (I10)", () => {
  // Only orderId is read on this path; printBothOnAccept is mocked.
  const order = { orderId: "QV-ACCEPT-FAIL" } as Order;

  beforeEach(() => {
    acceptOrderMock.mockReset();
    printBothOnAcceptMock.mockReset();
  });

  it("TC-I10: the toast warns the order may still have been accepted, and nothing prints", async () => {
    // The backend committed; the reply was lost on the way back.
    acceptOrderMock.mockReturnValue({ unwrap: () => Promise.reject(new Error("timeout")) });
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "mock-id");

    const { result } = renderHook(() => usePendingOrder(order));
    await act(async () => {
      await result.current.handleAccept();
    });

    expect(toastErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(toastErrorSpy.mock.calls[0][0])).toMatch(/may still have been accepted/i);

    // No auto-retry, no print, and no local move that would make it look normal.
    expect(acceptOrderMock).toHaveBeenCalledTimes(1);
    expect(printBothOnAcceptMock).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().acceptedOrders).toHaveLength(0);
  });

  it("TC-I10j: a failed accept leaves a durable stamp the Accepted card can read; a good one does not", async () => {
    sessionStorage.clear();
    vi.spyOn(toast, "error").mockImplementation(() => "mock-id");

    acceptOrderMock.mockReturnValue({ unwrap: () => Promise.reject(new Error("timeout")) });
    const failed = renderHook(() => usePendingOrder(order));
    await act(async () => {
      await failed.result.current.handleAccept();
    });
    expect(wasAcceptUnconfirmed("QV-ACCEPT-FAIL")).toBe(true);

    const okOrder = { orderId: "QV-ACCEPT-OK" } as Order;
    acceptOrderMock.mockReturnValue({ unwrap: () => Promise.resolve({ ok: true }) });
    const ok = renderHook(() => usePendingOrder(okOrder));
    await act(async () => {
      await ok.result.current.handleAccept();
    });
    expect(wasAcceptUnconfirmed("QV-ACCEPT-OK")).toBe(false);
  });

  it("TC-I10b: a successful accept still moves the order and prints both slips", async () => {
    acceptOrderMock.mockReturnValue({ unwrap: () => Promise.resolve({ ok: true }) });
    useDashboardStore.setState({ pendingOrders: [order] });

    const { result } = renderHook(() => usePendingOrder(order));
    await act(async () => {
      await result.current.handleAccept();
    });

    expect(printBothOnAcceptMock).toHaveBeenCalledTimes(1);
    expect(useDashboardStore.getState().acceptedOrders.map((o) => o.orderId)).toEqual([
      "QV-ACCEPT-FAIL",
    ]);
  });
});
