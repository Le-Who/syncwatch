"use client";

import { themeStorageKey } from "@/lib/theme";
import { Moon, Sparkles } from "lucide-react";
import { motion } from "motion/react";

function toggleTheme() {
  const root = document.documentElement;
  const theme = root.dataset.theme === "cyber" ? "cotton" : "cyber";
  if (theme === "cyber") {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme;
  }
  try {
    localStorage.setItem(themeStorageKey, theme);
  } catch {}
}

export function ThemeToggle() {
  return (
    <motion.button
      onClick={toggleTheme}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      className="theme-panel group fixed right-6 bottom-6 z-50 flex cursor-pointer items-center justify-center overflow-hidden rounded-full p-3"
      aria-label="Toggle Theme"
    >
      <div
        aria-hidden="true"
        className="relative flex h-6 w-6 items-center justify-center"
      >
        <span className="theme-toggle-cotton absolute text-pink-400 transition-[opacity,transform] duration-300">
          <Sparkles className="h-6 w-6" />
        </span>

        <span className="theme-toggle-cyber absolute text-[#00E5FF] transition-[opacity,transform] duration-300">
          <Moon className="h-6 w-6" />
        </span>
      </div>

      <span className="sr-only">Toggle Theme</span>
    </motion.button>
  );
}
