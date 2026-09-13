import { NavLink } from "react-router-dom";
import { Sun, Moon, X, LayoutDashboard, ClipboardList, CalendarClock } from "lucide-react";
import { useThemeStore } from "../stores/useThemeStore";
import { useAuthStore } from "../stores/useAuthStore";

interface SidebarProps {
  isMobileOpen: boolean;
  onMobileClose: () => void;
}

const navItems = [
  { label: "Dashboard", to: "/vendor/dashboard", icon: LayoutDashboard },
  { label: "Order History", to: "/vendor/order-history", icon: ClipboardList },
  { label: "Store Schedule", to: "/vendor/store-status", icon: CalendarClock },
];

const Sidebar = ({ onMobileClose }: SidebarProps) => {
  const { theme, toggleTheme } = useThemeStore();

  return (
    <aside className="h-full w-[260px] lg:w-[15%] lg:min-w-[180px] rounded-r-2xl lg:rounded-xl border-r lg:border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex flex-col shadow-2xl lg:shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#1e40af] to-[#3b82f6] flex items-center justify-center shadow-md">
            <span className="text-white font-black text-sm">Q</span>
          </div>
          <h1 className="text-lg font-black text-slate-900 dark:text-zinc-100 tracking-tight">
            QuickVerse
          </h1>
        </div>
        {/* Mobile close button */}
        <button
          onClick={onMobileClose}
          className="lg:hidden p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="space-y-1 flex-1">
        <p className="text-[9px] font-black text-slate-400 dark:text-zinc-600 uppercase tracking-[0.15em] mb-3 px-2">
          Navigation
        </p>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onMobileClose}
            end={item.to === "/vendor/dashboard"}
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 group",
                isActive
                  ? "bg-gradient-to-r from-[#1e40af]/10 to-[#3b82f6]/5 text-[#1e40af] dark:text-blue-400 border border-[#1e40af]/20 dark:border-blue-500/20 shadow-sm"
                  : "text-slate-500 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800 hover:text-slate-800 dark:hover:text-zinc-100",
              ].join(" ")
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  size={17}
                  strokeWidth={isActive ? 2.5 : 2}
                  className={`transition-all duration-200 ${
                    isActive
                      ? "text-[#1e40af] dark:text-blue-400"
                      : "text-slate-400 dark:text-zinc-500 group-hover:text-slate-600 dark:group-hover:text-zinc-300"
                  }`}
                />
                {item.label}
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#1e40af] dark:bg-blue-400" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Actions */}
      <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-slate-100 dark:border-zinc-800">
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center gap-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 px-3 py-2.5 text-sm font-semibold text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-all duration-300 active:scale-[0.97] w-full"
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          <div className="relative w-4.5 h-4.5 shrink-0">
            <Sun
              size={17}
              className={`absolute inset-0 transition-all duration-300 ${
                theme === "light" ? "opacity-100 rotate-0" : "opacity-0 rotate-90"
              }`}
            />
            <Moon
              size={17}
              className={`absolute inset-0 transition-all duration-300 ${
                theme === "dark" ? "opacity-100 rotate-0" : "opacity-0 -rotate-90"
              }`}
            />
          </div>
          <span>{theme === "dark" ? "Dark Mode" : "Light Mode"}</span>
        </button>

        <button
          onClick={() => {
            useAuthStore.getState().clearSession();
            window.location.href = "/";
          }}
          className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-3 py-2.5 text-sm font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-all duration-300 active:scale-[0.97] w-full"
        >
          Logout
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;