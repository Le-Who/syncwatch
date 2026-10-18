// @vitest-environment node
import { exec } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(exec);
const projectRoot = process.cwd();
const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("project clean command", () => {
  it("removes .next, preserves source files, and can run twice", async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), "syncwatch-clean-"));
    fixtures.push(fixture);
    await mkdir(path.join(fixture, ".next", "cache"), { recursive: true });
    await writeFile(
      path.join(fixture, ".next", "cache", "generated.json"),
      "{}",
    );
    await writeFile(
      path.join(fixture, "source.ts"),
      "export const intact = true;\n",
    );
    const scriptsDir = path.join(projectRoot, "scripts");
    if (existsSync(scriptsDir))
      await cp(scriptsDir, path.join(fixture, "scripts"), { recursive: true });
    const { scripts } = JSON.parse(
      await readFile(path.join(projectRoot, "package.json"), "utf8"),
    );
    const runClean = () =>
      execute(scripts.clean, {
        cwd: fixture,
        env: {
          ...process.env,
          PATH: `${path.join(projectRoot, "node_modules", ".bin")}${path.delimiter}${process.env.PATH}`,
        },
        timeout: 20_000,
      });

    await expect(runClean()).resolves.toMatchObject({ stderr: "" });
    expect(existsSync(path.join(fixture, ".next"))).toBe(false);
    expect(await readFile(path.join(fixture, "source.ts"), "utf8")).toBe(
      "export const intact = true;\n",
    );
    await expect(runClean()).resolves.toMatchObject({ stderr: "" });
    expect(await readFile(path.join(fixture, "source.ts"), "utf8")).toBe(
      "export const intact = true;\n",
    );
  }, 30_000);
});
