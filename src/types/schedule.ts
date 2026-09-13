
export type DayOfWeek = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

/**
 * Shape of individual operational slots.
 * Timings should follow the 24-hour format string: "HH:mm" (e.g., "09:00").
 */
export interface TimeSlot {
  openTime: string;
  closeTime: string;
}

/**
 * The full 7-day timing matrix object mapping.
 * Using a partial or full mapping ensures we can loop through days cleanly.
 */
export type OperatingHours = Record<DayOfWeek, TimeSlot>;


export interface SaveScheduleRequest {
  shopId: string;
  manualOfflineOverride: boolean;
  scheduleActive: boolean;
  operatingHours: string; // Escaped JSON structure serialized using JSON.stringify()
}

/**
 * Successful Response Structure for:
 * GET /v1/vendor-schedules/shop/{shopId}
 * POST /v1/vendor-schedules/configure
 */
export interface VendorScheduleResponse {
  id: string;
  shopId: string;
  manualOfflineOverride: boolean;
  scheduleActive: boolean;
  operatingHoursJson: string; // Raw escaped JSON string returned directly from PostgreSQL jsonb
  createdBy?: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
}