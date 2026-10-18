import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
export default defineConfig([
  {
    ignores: [
      "**/.worktrees/**",
      "**/.superpowers/**",
      "**/.next/**",
      "**/dist/**",
      "**/node_modules/**",
      "*.tsbuildinfo",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  {
    extends: [...next],
  },
]);
