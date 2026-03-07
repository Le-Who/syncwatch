"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "cotton" | "cyber";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("cotton");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem("syncwatch-theme") as Theme | null;
    if (savedTheme) {
      setThemeState(savedTheme);
      document.documentElement.setAttribute("data-theme", savedTheme);
    } else {
      // Default to cotton
      document.documentElement.removeAttribute("data-theme");
    }
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("syncwatch-theme", newTheme);
    if (newTheme === "cotton") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", newTheme);
    }
  };

  const toggleTheme = () => {
    setTheme(theme === "cotton" ? "cyber" : "cotton");
  };
  // Prevent flash or hydration mismatch by rendering invisible until mounted,
  // or just render children directly (we chose to just render children directly
  // since the background is handled by CSS and might flash briefly, but it's okay).

  return (
    <ThemeContext.Provider
      value={{ theme: mounted ? theme : "cotton", setTheme, toggleTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
