const config = {
  entry: ["app/**/page.tsx", "app/**/layout.tsx"],
  project: [
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
  ],
  ignoreDependencies: ["postcss-load-config"],
  rules: {
    types: "warn",
    exports: "warn",
    unlisted: "warn",
  },
};

export default config;
