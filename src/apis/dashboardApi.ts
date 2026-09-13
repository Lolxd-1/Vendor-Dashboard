import api from "./index";

const dashboardApi = api.injectEndpoints({
  endpoints: (build) => ({
    // Accept order with preparation time
    acceptOrder: build.mutation<any, { orderId: string; preparationTime: number }>({
      query: ({ orderId, preparationTime }) => ({
        url: `/quickVerse/v2/order/${orderId}/accept`,
        method: "PATCH",
        params: { preparationTime },
      }),
    }),
    
    // Reject order
    rejectOrder: build.mutation<any, { orderId: string; reason: string }>({
      query: ({ orderId, reason }) => ({
        url: `/quickVerse/v2/order/${orderId}/reject`,
        method: "PATCH",
        params: { reason },
      }),
    }),
    
    // Mark order as ready for pickup
    markOrderReady: build.mutation<any, { orderId: string }>({
      query: ({ orderId }) => ({
        url: `/quickVerse/v2/order/${orderId}/ready`,
        method: "PATCH",
      }),
    }),
    
    // Mark order as handed over to rider
    handoverOrder: build.mutation<any, { orderId: string }>({
      query: ({ orderId }) => ({
        url: `/quickVerse/v2/order/${orderId}/handover`,
        method: "PATCH",
      }),
    }),

    // Get dashboard stats (total, revenue, averages)
    getDashboardStats: build.query<any, string>({
      query: (shopId) => ({
        url: `/quickVerse/v2/order/${shopId}/dashboard-stats`,
        method: "GET",
      }),
    }),
  }),
});

export const {
  useAcceptOrderMutation,
  useRejectOrderMutation,
  useMarkOrderReadyMutation,
  useHandoverOrderMutation,
  useGetDashboardStatsQuery,
} = dashboardApi;
