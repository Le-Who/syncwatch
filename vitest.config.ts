import path from "path";
import {
  configDefaults,
  coverageConfigDefaults,
  defineConfig,
} from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["{lib,hooks,components,app}/**/*.{ts,tsx}", "server.ts"],
      exclude: [...coverageConfigDefaults.exclude, "**/__tests__/**"],
    },
    exclude: [
      ...configDefaults.exclude,
      "**/*.spec.ts",
      "e2e/**",
      "**/.worktrees/**",
      "**/.superpowers/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
