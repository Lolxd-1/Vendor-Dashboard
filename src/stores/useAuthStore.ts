import { persist, createJSONStorage } from "zustand/middleware";
import { create } from "zustand";
import { toast } from "react-hot-toast";

type AuthStore = {
  isAuthenticated: boolean;
  jwt: string | null;
  shopId: string | null;
  phone: string | null;
  saveSession: (jwt: string, shopId: string, phone: string) => void;
  clearSession: () => void;
};

// Decodes a JWT payload and compares `exp` (seconds since epoch) against now, minus a safety skew.
// FAIL-OPEN: returns false for a null/malformed/undecodable token or one with no `exp` claim.
// Rationale: never log out a vendor mid-shift because we could not parse something.
export const isTokenExpired = (jwt: string | null, skewSeconds = 30): boolean => {
  try {
    if (!jwt) return false;

    const parts = jwt.split(".");
    if (parts.length !== 3) return false;

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));

    if (typeof payload.exp !== "number") return false;

    return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
  } catch {
    return false;
  }
};

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      jwt: null,
      shopId: null,
      phone: null,

      saveSession: (jwt, shopId, phone) =>
        set({
          isAuthenticated: true,
          jwt,
          shopId,
          phone,
        }),

      clearSession: () =>
        set({
          isAuthenticated: false,
          jwt: null,
          shopId: null,
          phone: null,
        }),
    }),
    {
      name: "quickverse-auth-store",

      storage: createJSONStorage(() => localStorage),

      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        jwt: state.jwt,
        shopId: state.shopId,
        phone: state.phone,
      }),

      onRehydrateStorage: () => (state) => {
        if (!state) return;

        const expired = isTokenExpired(state.jwt);
        state.isAuthenticated = !!state.jwt && !expired;
        if (expired) {
          state.jwt = null;
          // Otherwise ProtectedRoute bounces straight to the login screen with
          // no explanation — the same once-only message the mount-check and
          // 60s-interval paths already show for every other expiry.
          toast.error("Session expired - please log in again");
        }
      },
    },
  ),
);