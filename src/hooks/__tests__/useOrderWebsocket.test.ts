import { act, cleanup, renderHook } from "@testing-library/react";
import { toast } from "react-hot-toast";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import indexHtmlSource from "../../../index.html?raw";
import dashboardLayoutSource from "../../Layout/Dashboardlayout.tsx?raw";
import { useAuthStore } from "../../stores/useAuthStore";
import { useDashboardStore } from "../../stores/useDashboardStore";
import { stompDebug, useOrderWebsocket } from "../useOrderWebsocket";
import hookSource from "../useOrderWebsocket.tsx?raw";

// A fake STOMP Client: captures the config passed to `new Client(...)` (debug/onConnect/etc.)
// and the subscribe callback, without ever opening a real socket. `activate()` is a no-op, so
// `webSocketFactory` (which would build a real SockJS instance) is never invoked.
vi.mock("@stomp/stompjs", () => {
  class FakeStompClient {
    static instances: FakeStompClient[] = [];
    config: Record<string, any>;
    messageHandler: ((message: { body: string }) => void) | null = null;

    constructor(config: Record<string, any>) {
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

import { Client } from "@stomp/stompjs";
const FakeClient = Client as unknown as {
  instances: Array<{
    config: Record<string, any>;
    messageHandler: ((message: { body: string }) => void) | null;
  }>;
};

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

    renderHook(() => useOrderWebsocket());
    const instance = FakeClient.instances[FakeClient.instances.length - 1];

    act(() => {
      instance.config.onConnect();
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
