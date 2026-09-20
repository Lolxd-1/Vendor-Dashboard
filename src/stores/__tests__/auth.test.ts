import { beforeEach, describe, expect, it } from "vitest";
import { isTokenExpired, useAuthStore } from "../useAuthStore";

const STORAGE_KEY = "quickverse-auth-store";

// Test-only helper: base64url-encodes a payload into a JWT-shaped string. No jwt library.
const base64UrlEncode = (value: unknown): string =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const makeToken = (payload: unknown): string =>
  `${base64UrlEncode({ alg: "HS256", typ: "JWT" })}.${base64UrlEncode(payload)}.signature`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({
    isAuthenticated: false,
    jwt: null,
    shopId: null,
    phone: null,
  });
});

describe("isTokenExpired", () => {
  it("TC1: a token expiring one hour from now is not expired", () => {
    const token = makeToken({ exp: nowSeconds() + 3600 });
    expect(isTokenExpired(token)).toBe(false);
  });

  it("TC2: a token that expired one hour ago is expired", () => {
    const token = makeToken({ exp: nowSeconds() - 3600 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it("TC3: a token expiring in 10s is already expired under the default 30s skew", () => {
    const token = makeToken({ exp: nowSeconds() + 10 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it("TC4: fails open for null, empty, and wrong part counts", () => {
    expect(isTokenExpired(null)).toBe(false);
    expect(isTokenExpired("")).toBe(false);
    expect(isTokenExpired("abc")).toBe(false);
    expect(isTokenExpired("a.b")).toBe(false);
    expect(isTokenExpired("a.b.c.d")).toBe(false);
  });

  it("TC5: fails open without throwing when the payload segment is not valid base64", () => {
    const token = `${base64UrlEncode({ alg: "HS256" })}.@@@@.signature`;
    expect(() => isTokenExpired(token)).not.toThrow();
    expect(isTokenExpired(token)).toBe(false);
  });

  it("TC6: fails open when the payload has no exp claim", () => {
    const token = makeToken({ sub: "vendor-1" });
    expect(isTokenExpired(token)).toBe(false);
  });

  it("TC7: fails open when exp is a string instead of a number", () => {
    const token = makeToken({ exp: "123" });
    expect(isTokenExpired(token)).toBe(false);
  });

  it("TC8: decodes a base64url payload containing '-' and '_' without mis-parsing it", () => {
    // This payload's base64url encoding is verified to contain both "-" and "_". Its exp is
    // a fixed, already-past timestamp, so a CORRECT decode must report expired === true.
    // A broken decode would throw inside isTokenExpired and fail open to false instead,
    // so this assertion (not just "does not throw") is what actually proves correctness.
    const payload = { exp: 1700000000, sub: "vendor-1", note: ">?>?>?" };
    const encodedPayload = base64UrlEncode(payload);
    expect(encodedPayload).toContain("-");
    expect(encodedPayload).toContain("_");

    const token = `${base64UrlEncode({ alg: "HS256" })}.${encodedPayload}.signature`;
    expect(isTokenExpired(token)).toBe(true);
  });
});

describe("auth store rehydration", () => {
  it("TC9: rehydrating with an EXPIRED jwt yields isAuthenticated === false", async () => {
    const expiredToken = makeToken({ exp: nowSeconds() - 3600 });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { isAuthenticated: true, jwt: expiredToken, shopId: "S1", phone: "9990001111" },
        version: 0,
      }),
    );

    await useAuthStore.persist.rehydrate();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("TC10: rehydrating with a VALID jwt yields isAuthenticated === true", async () => {
    const validToken = makeToken({ exp: nowSeconds() + 3600 });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { isAuthenticated: true, jwt: validToken, shopId: "S1", phone: "9990001111" },
        version: 0,
      }),
    );

    await useAuthStore.persist.rehydrate();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});

describe("clearSession", () => {
  it("TC11: sets isAuthenticated false and jwt null", () => {
    useAuthStore.setState({
      isAuthenticated: true,
      jwt: makeToken({ exp: nowSeconds() + 3600 }),
      shopId: "S1",
      phone: "9990001111",
    });

    useAuthStore.getState().clearSession();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().jwt).toBeNull();
  });
});
