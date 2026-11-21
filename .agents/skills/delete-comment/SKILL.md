---
name: delete-comment
description: Audit or clean up SyncWatch code comments in source, tests, scripts, migrations, and configuration. Use for comment-specific requests or /delete-comment.
---

# Delete comments

1. Read [repository standards](../../../CODING_STANDARDS.md). Inventory comments in the requested scope against the starting revision and note existing worktree changes. For a repository sweep, cover tracked source, test, script, migration, and configuration files and include new source in the working tree. Use syntax-aware extraction for each format. Inspect embedded code such as Lua in TypeScript and PL/pgSQL in SQL, and check strings and fixtures before editing.
2. Check each candidate against its implementation, tests, and history when its purpose is unclear. Record the original path and line and assign an outcome.

   | Category        | Evidence                                                       | Action                                                                                                |
   | --------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
   | Tautology       | Restates the code or assertion                                 | Delete                                                                                                |
   | Stale           | Describes a superseded implementation or an inaccurate claim   | Delete                                                                                                |
   | Excuse          | Rationalizes an implementation shortcut that still needs a fix | Delete and file an issue when publishing is authorized                                                |
   | Decision Record | Explains an important, non-obvious trade-off or constraint     | Record the decision and its rationale in [docs/adr](../../../docs/adr/) and delete the source comment |

   Protect comments consumed by tools, required type annotations, generated markers, license notices, and intentional fixture content. Record the consumer or constraint for each retained comment. Verify uncertain rationale before deleting it.

3. Keep review-only requests read-only. For authorized cleanup, preserve behavior and use existing checks. For each Excuse, look for an existing issue before filing and include the location, the observed problem, the impact, and a testable fix. Include an issue-ready finding when publishing is outside the granted scope.
4. Remove the corresponding entry from the [lint baseline](../../../scripts/comment-baseline.json) when its protected comment is no longer needed. Review the diff, run `pnpm lint:comments`, and run the affected repository checks. To compare with a starting revision, run `pnpm lint:comments --base <ref>`. Report coverage, removals, retained exceptions, ADRs, issue links or drafts, and any verification gaps.
