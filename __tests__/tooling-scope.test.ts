// @vitest-environment node
import path from "node:path";
import { ESLint } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createVitest, type Vitest } from "vitest/node";

const root = process.cwd();
let runner: Vitest;
const eslint = new ESLint({ cwd: root });

beforeAll(async () => {
  // Loading Next's lint configuration is setup, not a per-path assertion.
  await eslint.calculateConfigForFile(path.join(root, "server.ts"));
  runner = await createVitest("test", {
    root,
    config: path.join(root, "vitest.config.ts"),
    watch: false,
  });
}, 30_000);

afterAll(async () => {
  await runner?.close();
});

describe("tooling discovery stays inside the primary source tree", () => {
  it.each([
    ".worktrees/other-checkout/__tests__/player.test.ts",
    ".superpowers/scratch/diagnostic.test.ts",
    "nested/node_modules/vendor/vendor.test.ts",
    ".next/generated.test.ts",
    "dist/generated.test.ts",
    "coverage/generated.test.ts",
    "playwright-report/generated.test.ts",
    "test-results/generated.test.ts",
    "e2e/player.spec.ts",
  ])("does not discover %s as a unit test", (relativePath) => {
    expect(
      runner.getRootProject().matchesTestGlob(path.join(root, relativePath)),
    ).toBe(false);
  });

  it("continues discovering the actual project unit tests", () => {
    expect(
      runner
        .getRootProject()
        .matchesTestGlob(
          path.join(root, "__tests__/queue-advancement.test.ts"),
        ),
    ).toBe(true);
  });

  it.each([
    ".worktrees/other-checkout/components/Player.tsx",
    ".superpowers/scratch/diagnostic.ts",
    ".next/generated.js",
    "dist/generated.js",
    "nested/.next/generated.js",
    "nested/dist/generated.js",
    "nested/coverage/generated.js",
    "nested/playwright-report/generated.js",
    "test-results/generated.js",
  ])("does not lint %s", async (relativePath) => {
    expect(await eslint.isPathIgnored(path.join(root, relativePath))).toBe(
      true,
    );
  });

  it("continues linting the actual project source", async () => {
    expect(await eslint.isPathIgnored(path.join(root, "server.ts"))).toBe(
      false,
    );
  });
});
