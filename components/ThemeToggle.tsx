"use client";

import { useTheme } from "@/components/ThemeProvider";
import { Moon, Sparkles } from "lucide-react";
import { motion } from "motion/react";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <motion.button
      onClick={toggleTheme}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      className="theme-panel group fixed right-6 bottom-6 z-50 flex cursor-pointer items-center justify-center overflow-hidden rounded-full p-3"
      aria-label="Toggle Theme"
    >
      <div className="relative flex h-6 w-6 items-center justify-center">
        <motion.div
          initial={false}
          animate={{
            scale: theme === "cotton" ? 1 : 0,
            opacity: theme === "cotton" ? 1 : 0,
            rotate: theme === "cotton" ? 0 : -90,
          }}
          transition={{ duration: 0.3 }}
          className="absolute text-pink-400"
        >
          <Sparkles className="h-6 w-6" />
        </motion.div>

        <motion.div
          initial={false}
          animate={{
            scale: theme === "cyber" ? 1 : 0,
            opacity: theme === "cyber" ? 1 : 0,
            rotate: theme === "cyber" ? 0 : 90,
          }}
          transition={{ duration: 0.3 }}
          className="absolute text-[#00E5FF]"
        >
          <Moon className="h-6 w-6" />
        </motion.div>
      </div>

      <span className="sr-only">Toggle Theme</span>
    </motion.button>
  );
}
