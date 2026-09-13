import { NavLink } from "react-router-dom";
import { LayoutDashboard, ClipboardList, CalendarClock } from "lucide-react";

const navItems = [
  { label: "Dashboard", to: "/vendor/dashboard", icon: LayoutDashboard },
  { label: "Orders",    to: "/vendor/order-history", icon: ClipboardList },
  { label: "Schedule",  to: "/vendor/store-status",  icon: CalendarClock },
];

const BottomNav = () => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 lg:hidden">
      <div className="bg-white/95 dark:bg-zinc-900/98 backdrop-blur-xl border-t border-slate-200/80 dark:border-zinc-800/80 shadow-[0_-4px_20px_rgba(0,0,0,0.07)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.35)]">
        <div className="flex items-stretch justify-around px-1 pb-safe">
          {navItems.map(({ label, to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  "flex flex-col items-center justify-center gap-0.5 py-1.5 px-3 rounded-xl my-1 flex-1 mx-0.5 transition-all duration-200 active:scale-95",
                  isActive
                    ? "bg-[#1e40af]/10 dark:bg-blue-500/15 text-[#1e40af] dark:text-blue-400"
                    : "text-slate-400 dark:text-zinc-500",
                ].join(" ")
              }
            >
              {({ isActive }) => (
                <>
                  <div className="relative">
                    <Icon
                      size={20}
                      strokeWidth={isActive ? 2.5 : 1.8}
                      className="transition-all duration-200"
                    />
                    {isActive && (
                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-[#1e40af] dark:bg-blue-400 rounded-full" />
                    )}
                  </div>
                  <span className={`text-[9px] font-bold tracking-wide ${isActive ? "opacity-100" : "opacity-55"}`}>
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
};

export default BottomNav;
