import React, { useState } from "react";
import { Clock, Loader2, Calendar } from "lucide-react";
import type { DayOfWeek, OperatingHours } from "../../types/schedule";

interface WeeklyScheduleCardProps {
  initialData: OperatingHours;
  onSave: (data: OperatingHours) => Promise<void>;
  isSaving: boolean;
}

type DayConfig = {
  isActive: boolean;
  isAllDay: boolean;
  startTime: string;
  endTime: string;
};

const DAYS: DayOfWeek[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── NEW: Dynamic Time Generator ───────────────────────────────────
// This fetches the user's real-time system clock (e.g., "14:30")
const getCurrentTime = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
};

export const WeeklyScheduleCard = ({ initialData, onSave, isSaving }: WeeklyScheduleCardProps) => {
  
  // ─── 1. State Initialization (Data Hydration) ─────────────────────
  const [weekConfig, setWeekConfig] = useState<Record<DayOfWeek, DayConfig>>(() => {
    const initialState: any = {};
    const currentTime = getCurrentTime();

    DAYS.forEach((day) => {
      const existingSlot = initialData[day];
      const isActive = !!(existingSlot && existingSlot.openTime && existingSlot.closeTime);
      const isAllDay = isActive && existingSlot.openTime === "00:00" && existingSlot.closeTime === "00:00";
      
      initialState[day] = {
        isActive,
        isAllDay,
        // ✅ FIXED: Using dynamic current time instead of hardcoded "09:00" and "22:00"
        startTime: isActive && !isAllDay ? existingSlot.openTime : currentTime,
        endTime: isActive && !isAllDay ? existingSlot.closeTime : currentTime,
      };
    });
    return initialState;
  });

  // ─── 2. State Mutators ──────────────────────────────────────────
  const updateDay = (day: DayOfWeek, key: keyof DayConfig, value: any) => {
    setWeekConfig((prev) => ({
      ...prev,
      [day]: { ...prev[day], [key]: value },
    }));
  };

  // ─── 3. Submit Pipeline ─────────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {} as OperatingHours;

    DAYS.forEach((day) => {
      const config = weekConfig[day];
      if (config.isActive) {
        payload[day] = {
          openTime: config.isAllDay ? "00:00" : config.startTime,
          closeTime: config.isAllDay ? "00:00" : config.endTime,
        };
      }
    });

    onSave(payload);
  };

  // ─── Premium UI Classes ─────────────────────────────────────────
  const inputClasses = "bg-white dark:bg-[#131316] border border-slate-300 dark:border-zinc-700/80 rounded-lg px-2 sm:px-3 py-2 text-xs text-slate-900 dark:text-zinc-100 shadow-inner focus:outline-none focus:border-[#1e40af] dark:focus:border-emerald-500/80 focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-emerald-500/20 transition-all duration-200 [color-scheme:light] dark:[color-scheme:dark]";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col bg-white dark:bg-[#18181b] border border-slate-200 dark:border-zinc-700/60 rounded-2xl shadow-sm dark:shadow-[0_8px_30px_rgba(255,255,255,0.04)] overflow-hidden transition-all duration-300">
      
      {/* Header Section */}
      <div className="flex items-start gap-3 p-5 border-b border-slate-200 dark:border-zinc-800/80 bg-slate-50 dark:bg-zinc-900/40">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 dark:from-zinc-800 dark:to-zinc-900 border border-blue-200 dark:border-zinc-700/60 text-[#1e40af] dark:text-emerald-400 shadow-sm shrink-0">
          <Clock size={18} />
        </div>
        <div className="pt-0.5">
          <h4 className="text-[15px] font-bold text-slate-900 dark:text-zinc-100 tracking-wide">Configure Weekly Offline Schedule</h4>
          <p className="text-xs text-slate-500 dark:text-zinc-400 font-medium mt-0.5">Manage repeating weekly closures across all days.</p>
        </div>
      </div>

      {/* Interactive 7-Day Matrix */}
      <div className="p-2 divide-y divide-slate-100 dark:divide-zinc-800/50">
        {DAYS.map((day) => {
          const config = weekConfig[day];

          return (
            <div key={day} className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 p-3 sm:p-3 rounded-xl transition-colors duration-200 ${config.isActive ? "bg-blue-50/50 dark:bg-zinc-800/20" : "hover:bg-slate-50 dark:hover:bg-zinc-900/30"}`}>
              
              {/* Left Side: Master Toggle & Day Name */}
              <div className="flex items-center justify-between gap-4 w-full sm:w-1/3">
                <div className="flex items-center gap-4">
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={config.isActive} 
                      onChange={(e) => updateDay(day, "isActive", e.target.checked)} 
                    />
                    <div className="w-10 h-5.5 bg-slate-200 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 dark:after:bg-zinc-400 peer-checked:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-[#1e40af] dark:peer-checked:bg-emerald-500 peer-checked:border-[#1e40af] dark:peer-checked:border-emerald-500"></div>
                  </label>
                  <span className={`text-sm font-semibold transition-colors duration-200 ${config.isActive ? "text-slate-900 dark:text-zinc-100" : "text-slate-400 dark:text-zinc-500"}`}>
                    {day === "Thu" ? "Thursday" : day === "Tue" ? "Tuesday" : day === "Wed" ? "Wednesday" : day === "Sat" ? "Saturday" : day === "Sun" ? "Sunday" : day === "Mon" ? "Monday" : "Friday"}
                  </span>
                </div>

                {/* Mobile-Only Action Button (Row 1 Right Side) */}
                {config.isActive && (
                  <div className="sm:hidden shrink-0">
                    {config.isAllDay ? (
                      <button type="button" onClick={() => updateDay(day, "isAllDay", false)} className="text-[10px] font-bold text-[#1e40af] dark:text-emerald-400 transition-colors uppercase tracking-widest border border-[#1e40af]/30 dark:border-emerald-500/30 px-3 py-1.5 rounded-md bg-blue-50 dark:bg-emerald-500/10 active:scale-95">
                        Set Times
                      </button>
                    ) : (
                      <button type="button" onClick={() => updateDay(day, "isAllDay", true)} className="text-[10px] font-bold text-slate-500 dark:text-zinc-500 hover:text-rose-500 dark:hover:text-rose-400 transition-colors uppercase tracking-widest border border-slate-200 dark:border-zinc-800 px-3 py-1.5 rounded-md hover:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10 active:scale-95">
                        All Day
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Right Side: Conditional Time Controls */}
              <div className="flex flex-wrap sm:flex-nowrap items-center justify-start sm:justify-end gap-2 sm:gap-3 w-full sm:w-2/3 mt-2 sm:mt-0">
                {config.isActive ? (
                  config.isAllDay ? (
                    // State A: All Day Closure View
                    <div className="flex items-center justify-between w-full sm:w-auto gap-3 animate-in fade-in zoom-in-95 duration-200">
                      <span className="px-4 py-2 bg-rose-50 dark:bg-zinc-950 border border-rose-200 dark:border-zinc-800 text-rose-600 dark:text-rose-400 text-xs font-bold rounded-lg tracking-wide uppercase flex-1 sm:flex-none text-center">
                        All Day Close
                      </span>
                      <button type="button" onClick={() => updateDay(day, "isAllDay", false)} className="hidden sm:block text-[10px] font-bold text-slate-500 dark:text-zinc-500 hover:text-[#1e40af] dark:hover:text-emerald-400 transition-colors uppercase tracking-widest border border-slate-200 dark:border-zinc-800 px-2 py-1.5 rounded-md hover:border-[#1e40af]/30 dark:hover:border-emerald-500/30 hover:bg-blue-50 dark:hover:bg-emerald-500/10">
                        Set Times
                      </button>
                    </div>
                  ) : (
                    // State B: Custom Times View
                    <div className="flex items-center justify-between gap-1.5 sm:gap-2 animate-in fade-in zoom-in-95 duration-200 w-full sm:w-auto">
                      <input 
                        type="time" 
                        value={config.startTime} 
                        onChange={(e) => updateDay(day, "startTime", e.target.value)} 
                        className={`${inputClasses} flex-1 sm:flex-none sm:w-[120px] min-w-0`} 
                      />
                      <span className="text-slate-300 dark:text-zinc-600 font-bold shrink-0">-</span>
                      <input 
                        type="time" 
                        value={config.endTime} 
                        onChange={(e) => updateDay(day, "endTime", e.target.value)} 
                        className={`${inputClasses} flex-1 sm:flex-none sm:w-[120px] min-w-0`} 
                      />
                      <button type="button" onClick={() => updateDay(day, "isAllDay", true)} className="hidden sm:block ml-1 sm:ml-2 text-[10px] font-bold text-slate-500 dark:text-zinc-500 hover:text-rose-500 dark:hover:text-rose-400 transition-colors uppercase tracking-widest border border-slate-200 dark:border-zinc-800 px-2 py-1.5 rounded-md hover:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10 shrink-0">
                        All Day
                      </button>
                    </div>
                  )
                ) : (
                  <span className="text-[11px] font-medium text-slate-300 dark:text-zinc-700 italic pr-4">Closed</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer / Submit Button */}
      <div className="p-5 border-t border-slate-200 dark:border-zinc-800/80 bg-slate-50 dark:bg-zinc-900/40">
        <button 
          type="submit" 
          disabled={isSaving} 
          className="w-full sm:w-auto px-8 py-3 bg-[#1e40af] hover:bg-[#1e3a8a] dark:bg-zinc-100 dark:hover:bg-white disabled:bg-slate-200 dark:disabled:bg-zinc-800 disabled:text-slate-400 dark:disabled:text-zinc-500 text-white dark:text-zinc-950 text-xs font-extrabold tracking-widest uppercase rounded-xl shadow-[0_0_20px_rgba(30,64,175,0.15)] dark:shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all duration-300 flex items-center justify-center gap-2 active:scale-[0.98] mx-auto"
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Calendar size={16} />}
          Save Schedule
        </button>
      </div>

    </form>
  );
};