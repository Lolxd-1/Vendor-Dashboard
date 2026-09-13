import { persist, createJSONStorage } from "zustand/middleware";
import { create } from "zustand";

type AuthStore = {
  isAuthenticated: boolean;
  jwt: string | null;
  shopId: string | null;
  phone: string | null;
  saveSession: (jwt: string, shopId: string, phone: string) => void;
  clearSession: () => void;
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
        if (state?.jwt) {
          state.isAuthenticated = true;
        }
      },
    },
  ),
);