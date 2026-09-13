
import api from "./index";
import type { OrderApiResponse } from "../types/order";
import { OrderStatusFilter, TimeFilterOption } from "../types/filters";

export interface OrderFilterParams {
  shopId: string;
  orderStatus?: OrderStatusFilter[]; 
  timeRange?: TimeFilterOption;
  fromTime?: string;
  toTime?: string;
}


interface BackendOrderPayload {
  response: {
    orders: OrderApiResponse[];
  };
}

const orderApi = api.injectEndpoints({
  endpoints: (build) => ({
    getVendorOrders: build.query<OrderApiResponse[], OrderFilterParams>({
      query: ({ shopId, ...filters }) => {
        const cleanParams = new URLSearchParams();

        // 1. Add orderStatus array (multiple params with same name)
        if (filters.orderStatus && filters.orderStatus.length > 0) {
          filters.orderStatus.forEach(status => {
            cleanParams.append("orderStatus", status);
          });
        }

        // 2. Add timeRange
        if (filters.timeRange) {
          cleanParams.append("timeRange", filters.timeRange);
        }

        // 3. Add fromTime/toTime for CUSTOM range
        if (filters.timeRange === TimeFilterOption.CUSTOM) {
          if (filters.fromTime) cleanParams.append("fromTime", filters.fromTime);
          if (filters.toTime) cleanParams.append("toTime", filters.toTime);
        }

        return {
          url: `/quickVerse/v2/order/${shopId}/orders`,
          method: "GET",
          ...(cleanParams.toString() && { params: cleanParams }),
        };
      },
      
      transformResponse: (response: BackendOrderPayload): OrderApiResponse[] => {
        return response?.response?.orders || [];
      },
    }),
  }),
});

export const { useGetVendorOrdersQuery } = orderApi;