import { useState } from "react";
import { useConfigureVendorScheduleMutation, useToggleManualOfflineMutation } from "../apis/schedule";
import type { DayOfWeek, OperatingHours } from "../types/schedule";
import { useAuthStore } from '../stores/useAuthStore';

export type ScheduleFeedback = { type: 'success' | 'error' |'offline'; message: string } | null;

export const useSchedule = () => {
  const { shopId } = useAuthStore();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [feedback, setFeedback] = useState<ScheduleFeedback>(null);

  const [configureSchedule, { isLoading: isSaving }] = useConfigureVendorScheduleMutation();
  const [toggleManualOffline, { isLoading: isToggling }] = useToggleManualOfflineMutation();

  const toggleFormPanel = () => { setIsFormOpen((prev) => !prev); setFeedback(null); };
  const clearFeedback = () => setFeedback(null);

  // ─── BUG 2 FIX: Corrected Toggle Logic & Added Error Timeout ─────────
  const handleToggleStoreStatus = async (isCurrentlyOnline: boolean) => {
    if (!shopId) return;
    setFeedback(null);

    try {
      // Logic Fix: If Online (true) -> We want Offline (true). So send exactly isCurrentlyOnline!
      await toggleManualOffline({
        shopId,
        manualOfflineOverride: isCurrentlyOnline,
      }).unwrap();

      setFeedback({ 
        type: isCurrentlyOnline ? 'offline' : 'success', 
        message: `Store is now ${isCurrentlyOnline ? 'Offline' : 'Online'}` 
      });
      setTimeout(() => setFeedback(null), 2500);
      
    } catch (error) {
      console.error("Failed to toggle status:", error);
      setFeedback({ type: 'error', message: 'Failed to change store status.' });
      
      // ✅ FIX: Auto-close error message after 2.5 seconds
      setTimeout(() => setFeedback(null), 2500);
    }
  };

  // ─── BUG 3 FIX: Added Error Timeout to Config Save ─────────────────
  const saveScheduleGrid = async (operatingHoursObj: OperatingHours) => {
    if (!shopId) {
      setFeedback({ type: 'error', message: 'Session expired. Shop ID missing.' });
      setTimeout(() => setFeedback(null), 2500);
      return;
    }
    setFeedback(null);

    try {
      const stringifiedHours = JSON.stringify(operatingHoursObj);
      await configureSchedule({
        shopId,
        manualOfflineOverride: false, 
        scheduleActive: true,         
        operatingHours: stringifiedHours,
      }).unwrap(); 

      setFeedback({ type: 'success', message: "Weekly schedule successfully deployed!" });
      setTimeout(() => {
        setIsFormOpen(false);
        setFeedback(null);
      }, 1500);
    } catch (error) {
      console.error("Schedule configuration error:", error);
      setFeedback({ type: 'error', message: "Failed to save configuration. Please verify inputs." });
      
      // ✅ FIX: Auto-close error message after 3 seconds
      setTimeout(() => setFeedback(null), 3000); 
    };
  };

  const handleDeleteDay = async (
    dayToDelete: DayOfWeek,
    currentOperatingHours: OperatingHours
  ) => {
    const { [dayToDelete]: removedDay, ...remainingDays } = currentOperatingHours;
    await saveScheduleGrid(remainingDays as OperatingHours);
  };

  return {
    isFormOpen,
    viewAllOpen,
    isSaving,
    feedback,
    clearFeedback,
    toggleFormPanel,
    setViewAllOpen,
    isToggling,
    handleToggleStoreStatus,
    handleDeleteDay,
    saveScheduleGrid,
  };
};