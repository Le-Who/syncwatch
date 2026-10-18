# Legacy audit and regression fixes

> **For agentic workers:** Use the debugging, test-driven-development, and verification-before-completion workflows. Independent audits and fixes are delegated to `gpt-6.1-sol`; the controller integrates and verifies the complete working tree.

**Goal:** Remove demonstrably unused code and repair reproducible defects without losing existing work or durable room data.

**Architecture:** Preserve the existing Next.js/Socket.IO application and Redis-first room model. Confine changes to confirmed dead code, tooling, connection lifecycle, persistence error handling, and input boundaries. Preserve compatibility that still has a live consumer.

**Tech stack:** Node.js 24, pnpm 10, Next.js 16, React 19, Socket.IO, Redis, Supabase, Vitest, Playwright.

**Spec:** User request of 2026-10-18: comprehensive legacy/dependency audit, safe removal, regression coverage, and correction of discovered defects.

## Global constraints

- Preserve all changes present at the start of this audit, including staged deletions and untracked tests.
- Do not use production credentials or mutate external services during verification.
- Do not delete historical migrations or compatibility code merely because it is called legacy.
- Prove bugs with failing behavioral tests before changing their implementation.
- Keep dependency updates compatible with existing major versions; investigate advisories rather than applying an indiscriminate upgrade.
- Do not commit, publish, or deploy as part of this request.

## Review focus

- A stale authentication response must not reopen a room after leaving or override a newer connection attempt.
- Sleep and temporary transport loss must preserve enough UI and room context to recover.
- Malformed socket payloads and failed I/O must not escape as unhandled promise rejections.
- A failed durable read must never be interpreted as permission to create an empty replacement room.
- Tooling must scan source and tests while excluding generated output and scratch checkouts.

## Tasks

### 1. Establish the baseline

- [x] Capture the existing working/staged diffs and untracked files outside the repository.
- [x] Inspect source, scripts, dependency graph, existing tests, and current dependency advisories.
- [x] Run the original tests, typecheck, ESLint, and Knip.
- Baseline: 650 tests passed, 16 skipped, one subprocess test exceeded Vitest's 5-second default; typecheck and lint passed. Knip found dead files and a CSS false positive. Dependency audit reported 18 high and 14 moderate findings; production-only audit reported two high findings.

### 2. Remove confirmed dead code and repair tooling

- [x] Remove orphan metadata/mobile/progress implementations, unused constants/schemas, obsolete diagnostic scripts, and the unused ESLint config.
- [x] Test `clean` against a temporary fixture before replacing unsupported `next clean`.
- [x] Correct the runtime dependency classification, Knip scope, command naming, and Prettier exclusions.
- [x] Retain Tailwind CSS imports, dynamic test imports, deployment configs, and stable UUID-v5 room identity mapping.

### 3. Repair client connection lifecycle

- [x] Add deferred-authentication regression tests for leave and overlapping connection attempts.
- [x] Add room-level reconnect and sleep/wake tests.
- [x] Invalidate stale asynchronous connection work, preserve UI during transport loss, and distinguish suspend from leave.

### 4. Repair server socket and durable-read boundaries

- [x] Add malformed-payload, missing-acknowledgement, concurrent-join, and I/O-failure tests.
- [x] Enforce the single-room-per-socket contract, including overlapping joins.
- [x] Use unambiguous missing-row semantics and propagate durable read failures without writing replacement state.
- [x] Verify valid new-room creation and existing persistence/migration behavior.

### 5. Repair numeric/media-input edge cases and dependency advisories

- [x] Reproduce nonfinite duration and unsafe numeric mask/timecode inputs in tests.
- [x] Verify provider-domain and playlist URL validation before accepting playlist imports.
- [x] Apply minimal fixes and run covering math/media tests.
- [x] Patch advisories within compatible dependency versions and record any advisory with no available fix.
- [x] Give subprocess tests an outer deadline compatible with their explicit child-process deadline.

### 6. Integrate and independently review

- [x] Inspect each delegated diff and its red/green evidence.
- [x] Run the complete suite with coverage, typecheck, lint, unused-code check, and production build.
- [x] Exercise disposable local Redis and deterministic browser tests where local tooling permits.
- [x] Obtain an independent review, resolve actionable findings, and write the final audit report with verification limits.

Final verification: 770 tests passed / 21 explicitly skipped; coverage lines 85.33%; 10 deterministic browser tests passed; typecheck, ESLint, Knip, production build, and bounded compiled-runtime smoke passed. Independent re-review approved both final corrections. Real Redis/cloud concurrency and live YouTube limits are recorded in docs/audits/2026-10-18-legacy-audit.md.
