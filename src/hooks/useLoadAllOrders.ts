import { useCallback } from "react";
import toast from "react-hot-toast";
import type { Order } from "../types/order";
import { useLazyGetVendorOrdersPageQuery, type OrderFilterParams } from "../apis/orderApi";
import { fetchAllOrderPages } from "../utils/fetchAllOrderPages";

// Loads every order of the given filter (all pages) with a progress toast.
// Resolves null when anything failed — the caller then does nothing.
export const useLoadAllOrders = () => {
  const [trigger] = useLazyGetVendorOrdersPageQuery();

  return useCallback(
    async (params: OrderFilterParams): Promise<Order[] | null> => {
      const id = toast.loading("Loading orders…");
      try {
        const orders = await fetchAllOrderPages(
          (page) => trigger({ ...params, page }).unwrap(),
          (loaded, total) => {
            if (total > 1) toast.loading(`Loading orders ${loaded}/${total}…`, { id });
          }
        );
        toast.dismiss(id);
        return orders;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network or server error";
        toast.error(`Couldn't load all orders: ${reason}. Nothing was exported or printed.`, {
          id,
          duration: 6000,
        });
        return null;
      }
    },
    [trigger]
  );
};
