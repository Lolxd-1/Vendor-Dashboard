
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

export interface VendorOrdersPage {
  orders: OrderApiResponse[];
  totalPages: number;
}

// Backend pages its answer: { orders, currentPage, totalPages, totalElements }.
export const toVendorOrdersPage = (
  response: { response?: { orders?: OrderApiResponse[]; totalPages?: number } }
): VendorOrdersPage => ({
  orders: response?.response?.orders || [],
  totalPages: Number(response?.response?.totalPages) || 0,
});

// Shared by both endpoints below, so a full export/print sends exactly the same
// filters as the Order History table.
export const buildVendorOrdersQuery = ({ shopId, ...filters }: OrderFilterParams) => {
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
};

const orderApi = api.injectEndpoints({
  endpoints: (build) => ({
    getVendorOrders: build.query<OrderApiResponse[], OrderFilterParams>({
      query: buildVendorOrdersQuery,
      
      transformResponse: (response: BackendOrderPayload): OrderApiResponse[] => {
        return response?.response?.orders || [];
      },
    }),

    // One page (50 orders, newest first) plus how many pages the filter has.
    // Used by Order History's Export / Print Items to collect every page.
    getVendorOrdersPage: build.query<VendorOrdersPage, OrderFilterParams & { page: number }>({
      query: ({ page, ...filters }) => {
        const req = buildVendorOrdersQuery(filters);
        const params = new URLSearchParams(req.params);
        params.append("page", String(page));
        return { ...req, params };
      },
      transformResponse: toVendorOrdersPage,
    }),
  }),
});

export const { useGetVendorOrdersQuery, useLazyGetVendorOrdersPageQuery } = orderApi;