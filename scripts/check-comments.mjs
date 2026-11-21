import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { commentScanner, scanComments } from "./code-comments.mjs";

const baselinePath = "scripts/comment-baseline.json";

function commentCounts(comments) {
  const counts = new Map();
  for (const comment of comments)
    counts.set(comment, (counts.get(comment) ?? 0) + 1);
  return counts;
}

function consume(counts, comment) {
  const count = counts.get(comment);
  if (count === undefined) return false;
  if (count === 1) counts.delete(comment);
  else counts.set(comment, count - 1);
  return true;
}

function commentsAtRevision(root, git, revision, files) {
  const comments = new Map();
  if (files.length === 0) return comments;
  const entries = git(
    "--literal-pathspecs",
    "ls-tree",
    "-rz",
    revision,
    "--",
    ...files,
  )
    .split("\0")
    .filter((entry) => entry.startsWith("100"))
    .map((entry) => {
      const separator = entry.indexOf("\t");
      return {
        id: entry.slice(0, separator).split(" ")[2],
        file: entry.slice(separator + 1),
      };
    });
  const objects = execFileSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: entries.map(({ id }) => `${id}\n`).join(""),
    maxBuffer: 16 * 1024 * 1024,
  });

  let offset = 0;
  for (const { id, file } of entries) {
    const headerEnd = objects.indexOf(10, offset);
    const [object, type, size] = objects
      .toString("utf8", offset, headerEnd)
      .split(" ");
    if (object !== id || type !== "blob" || !/^\d+$/.test(size)) {
      throw new Error(`Cannot read ${file} from ${revision}`);
    }
    const end = headerEnd + 1 + Number(size);
    const scan = commentScanner(file);
    if (scan) {
      const source = objects.toString("utf8", headerEnd + 1, end);
      comments.set(
        file,
        scanComments(scan, source).map(({ text }) => text),
      );
    }
    offset = end + 1;
  }
  return comments;
}

export function checkComments(root, base) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const baseline = new Map(
    Object.entries(
      JSON.parse(readFileSync(path.join(root, baselinePath), "utf8")),
    ),
  );
  const files = new Set(
    git("ls-files", "-z", "--cached", "--others", "--exclude-standard").split(
      "\0",
    ),
  );
  const diagnostics = [];

  function report(location, reason, comment) {
    const excerpt = JSON.stringify(comment.split("\n", 1)[0].slice(0, 100));
    diagnostics.push(
      `${location}: ${reason} ${excerpt} [syncwatch/no-new-code-comments]`,
    );
  }

  const remaining = new Map(
    Array.from(baseline, ([file, comments]) => [file, commentCounts(comments)]),
  );
  for (const file of files) {
    const scan = commentScanner(file);
    if (!scan) continue;
    const absolute = path.join(root, file);
    if (!lstatSync(absolute, { throwIfNoEntry: false })?.isFile()) continue;
    const allowed = remaining.get(file) ?? new Map();
    for (const comment of scanComments(scan, readFileSync(absolute, "utf8"))) {
      if (!consume(allowed, comment.text)) {
        report(
          `${file}:${comment.line}:${comment.column}`,
          "New code comment",
          comment.text,
        );
      }
    }
  }

  for (const [file, comments] of remaining) {
    for (const comment of comments.keys()) {
      report(baselinePath, `Remove stale allowance for ${file}`, comment);
    }
  }

  let prior = "HEAD";
  if (base !== undefined) {
    const commit = git(
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${base}^{commit}`,
    ).trim();
    prior = git("merge-base", "HEAD", commit).trim();
  }
  const previous = git("ls-tree", prior, "--", baselinePath)
    ? new Map(
        Object.entries(JSON.parse(git("show", `${prior}:${baselinePath}`))),
      )
    : commentsAtRevision(root, git, prior, [...baseline.keys()]);

  for (const [file, comments] of baseline) {
    const existing = commentCounts(previous.get(file) ?? []);
    for (const comment of comments) {
      if (!consume(existing, comment)) {
        report(baselinePath, `New allowance for ${file}`, comment);
      }
    }
  }
  return diagnostics;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({ options: { base: { type: "string" } } });
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trimEnd();
  const githubBase = process.env.GITHUB_BASE_REF;
  const base =
    values.base ??
    (githubBase ? `refs/remotes/origin/${githubBase}` : undefined);
  const diagnostics = checkComments(root, base);
  if (diagnostics.length > 0) {
    console.error(diagnostics.join("\n"));
    process.exitCode = 1;
  }
}
