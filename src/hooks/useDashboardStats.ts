import { useMemo } from 'react';
import { useGetDashboardStatsQuery } from '../apis/dashboardApi';
import { useAuthStore } from '../stores/useAuthStore';

export const useDashboardStats = () => {
  const { shopId } = useAuthStore();

  // ─── FETCH BACKEND API STATS (Auto-Poll every 1 minute) ───
  const { 
    data: apiStats, 
    isLoading, 
    isFetching, 
    refetch 
  } = useGetDashboardStatsQuery(shopId ?? "", { 
    skip: !shopId,
    pollingInterval: 60000 // ✅ 1 minute auto-refresh
  });
  
  const stats = useMemo(() => {
    // Default Fallback
    const defaultStats = {
      total: 0,
      pending: 0,
      accepted: 0,
      ready: 0,
      avgAcceptanceTime: "0 min",
      avgPreparationTime: "0 min",
      revenue: "₹0",
      completionRate: "0%"
    };

    // ✅ Read exactly from the "response" wrapper object your API sends
    const data = apiStats?.response; 

    if (data) {
      const acceptSecs = data.avgAcceptanceTimeSec || 0;
      const prepSecs = data.avgPreparationTimeSec || 0;

      return {
        total: data.totalOrdersToday || 0,
        pending: data.pendingOrdersToday || 0,
        accepted: data.acceptedOrdersToday || 0,
        ready: data.readyOrdersToday || 0,
        // Convert seconds to minutes safely
        avgAcceptanceTime: acceptSecs > 0 ? `${Math.floor(acceptSecs / 60)} min` : "0 min",
        avgPreparationTime: prepSecs > 0 ? `${Math.floor(prepSecs / 60)} min` : "0 min",
        // Format Currency
        revenue: `₹${(data.revenueToday || 0).toLocaleString('en-IN')}`,
        completionRate: `${data.completionRate || 0}%`
      };
    }

    return defaultStats;
  }, [apiStats]);

  // Export 'isFetching' so our manual refresh button can show a loading spinner
  return { stats, isLoading, isFetching, refresh: refetch };
};