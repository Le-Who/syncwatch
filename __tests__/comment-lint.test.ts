import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkComments } from "../scripts/check-comments.mjs";

const command = path.resolve("scripts/check-comments.mjs");
const baseline = "scripts/comment-baseline.json";
const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function fixture(entries: Record<string, string> = {}) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "syncwatch-comments-"));
  fixtures.push(cwd);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" });
  const write = (file: string, source: string) => {
    const absolute = path.join(cwd, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, source);
  };
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=SyncWatch",
      "-c",
      "user.email=lint@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "Test fixture",
    );
    return git("rev-parse", "HEAD").trim();
  };
  const lint = (githubBase = "") =>
    spawnSync(process.execPath, [command], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GITHUB_BASE_REF: githubBase },
    });

  git("init", "-q");
  git("config", "core.autocrlf", "false");
  write(baseline, "{}");
  for (const [file, source] of Object.entries(entries)) write(file, source);
  return { write, commit, lint, git, cwd };
}

it("reports new comments across source formats while leaving literal content alone", () => {
  const repo = fixture({
    ".gitignore": "ignored.mjs\n",
    ".env.example": 'SECRET="inside # literal" # env note\n',
    ".npmrc": 'value="inside # literal" ; npm note\n',
    "sample.tsx": [
      'const url = "https://example.test";',
      "const pattern = /[/][/]/;",
      "const template = `/* literal */ ${1 /* template note */}`;",
      "const view = <div>// visible /* visible */{/* jsx note */}</div>;",
      "void view; // eslint-disable-line no-unused-expressions",
    ].join("\n"),
    "app.css": 'body { content: "/* literal */"; color: /* css note */ red; }',
    "config.jsonc": '{ "value": "// literal" /* json note */ }',
    "workflow.yaml":
      'data: |\n  # scalar content\nname: "name # literal" # yaml note\n',
    "migration.sql": [
      "select $quoted$-- literal$quoted$;",
      "create function demo() returns integer as $body$",
      "begin return 1; /* sql note /* nested */ */ end;",
      "$body$ language plpgsql;",
      "do $$ begin perform '-- literal'; -- do note",
      "end $$;",
      "create function quoted_demo() returns text language sql as 'select ''-- literal''; -- quoted body note",
      "';",
    ].join("\n"),
    "redis-script.ts": [
      "const script = `",
      "  local sample = [=[-- literal]=]",
      "  return 1 -- lua note",
      "`;",
      "redis.eval(script, 0);",
    ].join("\n"),
    "app/api/youtube/search/route.ts": [
      "const workerCode = `",
      '  const sample = "// literal";',
      "  // worker note",
      "`;",
    ].join("\n"),
    "__tests__/persistence-migrations.test.ts":
      "await db.query(`select ${column} -- embedded SQL note`);\n",
    "next-env.d.ts": "// generated\n",
    "nested/next-env.d.ts": "// checked declaration\n",
    "pnpm-lock.yaml": "# generated\n",
    "README.md": "<!-- documentation -->\n",
  });
  repo.commit();
  repo.write("ignored.mjs", "// ignored\n");
  repo.write("untracked.mjs", "// untracked note\n");

  const { status, stderr } = repo.lint();
  expect(status).toBe(1);
  expect(stderr.trim().split(/\r?\n/)).toHaveLength(16);
  for (const diagnostic of [
    '"# env note"',
    '"; npm note"',
    '"/* template note */"',
    '"/* jsx note */"',
    '"// eslint-disable-line no-unused-expressions"',
    '"/* css note */"',
    '"/* json note */"',
    '"# yaml note"',
    '"/* sql note /* nested */ */"',
    '"-- do note"',
    '"-- quoted body note"',
    '"-- lua note"',
    '"// worker note"',
    '"-- embedded SQL note"',
    '"// untracked note"',
    '"// checked declaration"',
  ]) {
    expect(stderr).toContain(diagnostic);
  }
}, 30_000);

it("limits allowances by file and count and prevents baseline growth relative to Git", () => {
  const existing = "// existing note";
  const repo = fixture({
    "original.ts": `${existing}\nexport {};\n`,
  });
  rmSync(path.join(repo.cwd, baseline));
  const initial = repo.commit();
  const check = (base?: string) => checkComments(repo.cwd, base);
  repo.write(baseline, JSON.stringify({ "original.ts": [existing] }));
  expect(check(initial)).toEqual([]);
  const base = repo.commit();
  expect(check()).toEqual([]);

  repo.write("original.ts", `\r\n${existing}\r\nexport {};\r\n`);
  expect(check()).toEqual([]);
  repo.write("original.ts", `${existing}\n${existing}\nexport {};\n`);
  expect(check().join("\n")).toContain("original.ts:2:1: New code comment");

  rmSync(path.join(repo.cwd, "original.ts"));
  repo.write("copied.ts", `${existing}\nexport {};\n`);
  const moved = check().join("\n");
  expect(moved).toContain("copied.ts:1:1: New code comment");
  expect(moved).toContain("Remove stale allowance for original.ts");

  repo.write(baseline, JSON.stringify({ "copied.ts": [existing] }));
  expect(check().join("\n")).toContain("New allowance for copied.ts");
  repo.commit();
  expect(check()).toEqual([]);
  expect(check(initial).join("\n")).toContain("New allowance for copied.ts");
  expect(check(base).join("\n")).toContain("New allowance for copied.ts");
  repo.git("update-ref", "refs/remotes/origin/main", base);
  const ci = repo.lint("main");
  expect(ci.status).toBe(1);
  expect(ci.stderr).toContain("New allowance for copied.ts");

  repo.write("copied.ts", "export {};\n");
  repo.write(baseline, "{}");
  expect(check(base)).toEqual([]);
}, 60_000);
