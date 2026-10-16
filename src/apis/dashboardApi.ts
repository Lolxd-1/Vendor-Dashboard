import api from "./index";

export interface DashboardStatsResponse {
  response?: {
    totalOrdersToday?: number;
    pendingOrdersToday?: number;
    acceptedOrdersToday?: number;
    readyOrdersToday?: number;
    avgAcceptanceTimeSec?: number;
    avgPreparationTimeSec?: number;
    revenueToday?: number;
    completionRate?: number;
  };
}

const dashboardApi = api.injectEndpoints({
  endpoints: (build) => ({
    // Accept order with preparation time
    acceptOrder: build.mutation<unknown, { orderId: string; preparationTime: number }>({
      query: ({ orderId, preparationTime }) => ({
        url: `/quickVerse/v2/order/${orderId}/accept`,
        method: "PATCH",
        params: { preparationTime },
      }),
    }),
    
    // Reject order
    rejectOrder: build.mutation<unknown, { orderId: string; reason: string }>({
      query: ({ orderId, reason }) => ({
        url: `/quickVerse/v2/order/${orderId}/reject`,
        method: "PATCH",
        params: { reason },
      }),
    }),
    
    // Mark order as ready for pickup
    markOrderReady: build.mutation<unknown, { orderId: string }>({
      query: ({ orderId }) => ({
        url: `/quickVerse/v2/order/${orderId}/ready`,
        method: "PATCH",
      }),
    }),
    
    // Mark order as handed over to rider
    handoverOrder: build.mutation<unknown, { orderId: string }>({
      query: ({ orderId }) => ({
        url: `/quickVerse/v2/order/${orderId}/handover`,
        method: "PATCH",
      }),
    }),

    // Get dashboard stats (total, revenue, averages)
    getDashboardStats: build.query<DashboardStatsResponse, string>({
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
