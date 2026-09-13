import { create } from "zustand";

type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = "qv-theme";

// Apply theme class to <html> element
const applyTheme = (theme: Theme) => {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
};

// Read saved theme from localStorage (default: "dark")
const getStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return "dark";
};

export const useThemeStore = create<ThemeState>((set, get) => {
  // Initialize on store creation
  const initial = getStoredTheme();
  applyTheme(initial);

  return {
    theme: initial,

    toggleTheme: () => {
      const next = get().theme === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem(STORAGE_KEY, next);
      set({ theme: next });
    },

    setTheme: (theme: Theme) => {
      applyTheme(theme);
      localStorage.setItem(STORAGE_KEY, theme);
      set({ theme });
    },
  };
});
