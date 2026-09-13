import type { DayOfWeek } from "../types/schedule";

/**
 * Determines if the shop is currently offline based on its operating hours schedule.
 * Shared utility used by both Navbar (status badge) and StoreSchedule page.
 */
export const checkIsCurrentlyOfflineBySchedule = (operatingHours: any): boolean => {
  const now = new Date();
  const days: DayOfWeek[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const currentDay = days[now.getDay()];

  const todaysSchedule = operatingHours[currentDay];

  // If no schedule exists for today, the shop is ONLINE
  if (!todaysSchedule) return false;

  // If it is a 24-hour closure, the shop is OFFLINE
  if (todaysSchedule.openTime === "00:00" && todaysSchedule.closeTime === "00:00") {
    return true;
  }

  // Compare current time with schedule
  const currentTimeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const start = todaysSchedule.openTime;
  const end = todaysSchedule.closeTime;

  if (start <= end) {
    return currentTimeStr >= start && currentTimeStr <= end;
  } else {
    return currentTimeStr >= start || currentTimeStr <= end;
  }
};
