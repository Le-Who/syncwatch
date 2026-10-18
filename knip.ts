const config = {
  entry: [
    "server.ts",
    "app/**/{page,layout,route,loading,error,global-error,not-found,template,default}.{ts,tsx}",
    "{app,components,hooks,lib,__tests__}/**/*.test.{ts,tsx}",
    "e2e/**/*.spec.ts",
    "e2e/trusted-proxy.ts",
  ],
  project: [
    "*.{ts,tsx,js,mjs,cjs}",
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "hooks/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "__tests__/**/*.{ts,tsx}",
    "e2e/**/*.{ts,tsx}",
    "scripts/**/*.{js,mjs,cjs}",
  ],
  ignoreDependencies: [
    "postcss-load-config", // JSDoc type in postcss.config.mjs, supplied by Next.
    "tailwindcss", // CSS @import in app/globals.css is not detected by Knip.
  ],
  rules: {
    types: "warn",
    exports: "warn",
    unlisted: "warn",
  },
};

export default config;
