import { useMemo } from "react";
import { useGetVendorScheduleQuery } from "../apis/schedule";
import { checkIsCurrentlyOfflineBySchedule } from "../utils/scheduleUtils";

/**
 * Custom hook that returns the live online/offline status of a shop.
 * Uses the schedule API + checkIsCurrentlyOfflineBySchedule utility.
 * 
 * Usage: const isOnline = useShopOnlineStatus(shopId);
 */
export const useShopOnlineStatus = (shopId: string | null): boolean => {
  const { data: scheduleData } = useGetVendorScheduleQuery(shopId || "", {
    skip: !shopId,
  });

  const isOnline = useMemo(() => {
    if (!scheduleData) return true; // Default to online while loading
    if (scheduleData.manualOfflineOverride) return false;

    const operatingHours = scheduleData.operatingHoursJson
      ? JSON.parse(scheduleData.operatingHoursJson)
      : {};

    return !checkIsCurrentlyOfflineBySchedule(operatingHours);
  }, [scheduleData]);

  return isOnline;
};
