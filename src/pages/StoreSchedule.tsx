import { CalendarPlus, Loader2, Info, AlertCircle, CheckCircle2 } from "lucide-react";

import { useGetVendorScheduleQuery } from "../apis/schedule";
import { useSchedule } from "../hooks/useSchedule";
import { useAuthStore } from "../stores/useAuthStore";
import type { DayOfWeek } from "../types/schedule";

import { WeeklyScheduleCard } from "../components/Schedule/WeeklyScheduleCard";
import { UpcomingSchedulesList } from "../components/Schedule/UpcomingScheduleList";


const checkIsCurrentlyOfflineBySchedule = (operatingHours: any): boolean => {
  const now = new Date();
  const days: DayOfWeek[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const currentDay = days[now.getDay()]; // Get today's actual day (e.g., "Tue")
  
  const todaysSchedule = operatingHours[currentDay];
  
  // If no schedule exists for today, the shop is ONLINE
  if (!todaysSchedule) return false; 

  // If it is a 24-hour closure, the shop is OFFLINE
  if (todaysSchedule.openTime === "00:00" && todaysSchedule.closeTime === "00:00") {
    return true;
  }

  // If there are specific times, compare them with the real-time clock
  const currentTimeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const start = todaysSchedule.openTime;
  const end = todaysSchedule.closeTime;

  // Handles normal hours (09:00 to 22:00) and midnight crossover hours (22:00 to 02:00)
  if (start <= end) {
    return currentTimeStr >= start && currentTimeStr <= end;
  } else {
    return currentTimeStr >= start || currentTimeStr <= end;
  }
};

export const StoreSchedulePage = () => {
  const { shopId } = useAuthStore();

  const { data: scheduleData, isLoading } = useGetVendorScheduleQuery(shopId || "", {
    skip: !shopId
  });

  const {
    isFormOpen,
    isSaving,
    isToggling,
    feedback,
    toggleFormPanel,
    saveScheduleGrid,
    handleToggleStoreStatus,
    handleDeleteDay,
  } = useSchedule(); 

  const operatingHours = scheduleData?.operatingHoursJson
    ? JSON.parse(scheduleData.operatingHoursJson)
    : {};


  const isOfflineByClock = checkIsCurrentlyOfflineBySchedule(operatingHours);
  const isShopOnline = scheduleData?.manualOfflineOverride ? false : !isOfflineByClock;

  const handleEditClick = (_day: DayOfWeek) => {
    if (!isFormOpen) toggleFormPanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteClick = (day: DayOfWeek) => {
    handleDeleteDay(day, operatingHours);
  };

  if (isLoading || !shopId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-400 dark:text-zinc-500 bg-transparent">
        <Loader2 className="animate-spin text-[#1e40af] dark:text-emerald-500 mb-2" size={24} />
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-zinc-400">
          {!shopId ? "Verifying Vendor..." : "Syncing Store Matrix..."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-900 dark:text-zinc-100 p-6 space-y-6">

      <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800/80 pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-zinc-100">Store Status</h1>
          <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5 font-medium">
            Monitor real-time shop visibility metrics and manage schedule operations.
          </p>
        </div>

        
      </div>

      <div className="p-4 sm:p-5 bg-white dark:bg-[#18181b] border border-slate-200 dark:border-zinc-700/60 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm dark:shadow-[0_8px_30px_rgba(255,255,255,0.03)]">
        <div className="flex flex-col gap-2 sm:gap-1.5 w-full sm:w-auto">
          
          {/* Row 1: Title + Toggle (Spaced between on mobile, packed left on desktop) */}
          <div className="flex items-center justify-between sm:justify-start gap-4">
            <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-200 tracking-wide">Current Shop Status</h3>
            <button
              onClick={() => handleToggleStoreStatus(isShopOnline)}
              disabled={isToggling}
              className={`relative flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-300 active:scale-95 ${
                isToggling ? "opacity-50 cursor-not-allowed" : ""
              } ${
                isShopOnline 
                  ? "bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/60" 
                  : "bg-rose-500/10 border-rose-500/30 hover:border-rose-500/60"
              }`}
            >
              <div className={`w-2.5 h-2.5 rounded-full ${isShopOnline ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]"}`} />
              <span className={`text-[10px] font-bold uppercase tracking-widest pr-1 ${isShopOnline ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                {isToggling ? "Updating..." : isShopOnline ? "Online" : "Offline"}
              </span>
            </button>
          </div>

          {/* Row 2: Info Message */}
          <p className="text-[11px] text-slate-500 dark:text-zinc-500 flex items-start sm:items-center gap-1.5 font-medium leading-snug w-full">
            <Info size={14} className="text-slate-400 dark:text-zinc-600 shrink-0 mt-0.5 sm:mt-0" />
           Click Toggle to manually change store status online/offline.
          </p>
        </div>

        <button
          onClick={toggleFormPanel}
          className={`w-full sm:w-auto flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl font-bold text-[10px] sm:text-xs uppercase tracking-wider transition-all duration-300 active:scale-[0.98] ${
            isFormOpen
              ? "bg-slate-100 dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700"
              : "bg-[#1e40af] dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-[#1e3a8a] dark:hover:bg-white shadow-[0_0_20px_rgba(30,64,175,0.15)] dark:shadow-[0_0_20px_rgba(255,255,255,0.1)]"
          }`}
        >
          <CalendarPlus size={14} />
          {isFormOpen ? "Close Scheduler" : "Add Offline Schedule"}
        </button>
      </div>

     {feedback && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border animate-in fade-in slide-in-from-top-2 duration-300 ${
          feedback.type === 'success' 
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400" 
            : "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
        }`}>
          {/* Dynamically swap icons based on state */}
          {feedback.type === 'success' ? <CheckCircle2 size={18} /> : 
           feedback.type === 'offline' ? <Info size={18} /> : 
           <AlertCircle size={18} />}
           
          <span className="text-xs font-bold tracking-wide">{feedback.message}</span>
        </div>
      )}

      {isFormOpen && (
        <div className="animate-in slide-in-from-top-4 fade-in duration-300">
          <WeeklyScheduleCard 
            key={scheduleData?.updatedAt || "form"} 
            initialData={operatingHours} 
            onSave={saveScheduleGrid} 
            isSaving={isSaving} 
          />
        </div>
      )}

      <UpcomingSchedulesList
        operatingHours={operatingHours}
        onEditClick={handleEditClick}
        onDeleteClick={handleDeleteClick}
      />

    </div>
  );
};

export default StoreSchedulePage;