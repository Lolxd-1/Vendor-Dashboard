import type {
  SaveScheduleRequest,
  VendorScheduleResponse
} from "../types/schedule";
import api from "./index"; // Injecting into your existing base API configuration

export const scheduleApi = api.injectEndpoints({
  endpoints: (build) => ({

    // ─── 1. FETCH SCHEDULE BY SHOP ID (GET) ─────────────────────────
    getVendorSchedule: build.query<VendorScheduleResponse, string>({
      query: (shopId) => ({
        url: `/v1/vendor-schedules/shop/${shopId}`,
        method: "GET",
      }),
      // Active Recall Guard: Defensively structuralizing incoming payload
      transformResponse: (response: VendorScheduleResponse): VendorScheduleResponse => {
        return {
          ...response,
          // Fallback to empty JSON string if backend encounters null variants
          operatingHoursJson: response?.operatingHoursJson ?? "{}",
        };
      },
      // Provides a tag to lock this query cache in memory
      providesTags: (_result, _error, shopId) => [{ type: "VendorSchedule", id: shopId }],
    }),

    // ─── 2. CONFIGURE / SAVE SCHEDULE GRID (POST) ───────────────────
    configureVendorSchedule: build.mutation<VendorScheduleResponse, SaveScheduleRequest>({
      query: (payload) => ({
        url: "/v1/vendor-schedules/configure",
        method: "POST",
        body: payload,
      }),

      invalidatesTags: (_result, _error, arg) => [{ type: "VendorSchedule", id: arg.shopId }],
    }),

    // ─── 3. EMERGENCY MANUAL OFFLINE OVERRIDE (PATCH) ───────────────
    toggleManualOffline: build.mutation<
      string, 
      { shopId: string; manualOfflineOverride: boolean }
    >({
      query: ({ shopId, manualOfflineOverride }) => ({
        url: `/v1/vendor-schedules/shop/${shopId}/manual-offline`,
        method: "PATCH",
        params: { manualOfflineOverride },
        responseHandler: "text", 
      }),
      invalidatesTags: (_result, _error, arg) => [{ type: "VendorSchedule", id: arg.shopId }],
    }),
  }),
});

// Exporting standard auto-generated hooks for your functional components
export const {
  useGetVendorScheduleQuery,
  useConfigureVendorScheduleMutation,
  useToggleManualOfflineMutation,
} = scheduleApi;