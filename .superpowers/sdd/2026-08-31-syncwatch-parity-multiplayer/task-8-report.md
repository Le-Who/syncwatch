# Task 8 hardening report

## Scope and implementation

Task 8 preserves the existing reconnect, ownership, nonce, acknowledgement, and
buffering behavior while hardening session issuance, Socket.IO admission,
rate-limit enforcement, and production dependencies.

- `app/api/auth/session/route.ts` ignores a body-supplied participant ID. It
  reuses a valid HttpOnly session cookie or issues a random UUID and a new
  session. Responses use `Cache-Control: no-store`; malformed cookies are
  replaced without logging their content.
- `lib/jwt-config.ts` allows a deliberately warned development fallback only
  outside production; production use without `JWT_SECRET` throws an actionable
  error.
- `lib/server-config.ts`, `server.ts`, `lib/rate-limit.ts`, and the API/Socket
  callers make trusted forwarding opt-in through `TRUST_PROXY=true`, normalize
  the production Socket.IO origin, and enforce it with both Socket.IO CORS and
  `allowRequest`.
- `lib/redis-rate-limit.ts` performs an atomic Redis prune/count/add with a
  unique `<timestamp>:<UUID>` sorted-set member. Redis absence or failure uses a
  bounded 10,000-key local limiter rather than failing open. Windows are
  auth 10/60s, metadata/search 20/60s, playlist 10/60s, joins 50/60s, and
  commands 60/10s.
- `lib/socket/commands.ts`, the shared command contract, service text, and
  store make a limited command return a nonce-correlated `RATE_LIMITED` ACK.
  The client records it but does not replay the mutation or request a snapshot.
- `lib/store.ts` adopts the response identity before socket join/reconnect and
  gates the existing browser globals outside production. The session token is
  still held in browser JavaScript state for Socket.IO's auth fallback; this is
  a residual XSS-exposure design concern, not removed here because changing it
  requires a larger Socket.IO cookie-only session redesign.
- `app/api/youtube/search/route.ts` runs its static data URL as an ESM worker
  and uses a `createRequire` anchored to the application package to load the
  CommonJS `yt-search` dependency. This preserves the isolated, timed worker
  without relying on `eval: true`, and works in Node 24 and Next 16.3.4.

Extra scoped files are intentional: `lib/server-config.ts` isolates origin
normalization from the custom server; `lib/__tests__/store.test.ts`,
`__tests__/room-handler.test.ts`, and `__tests__/server.test.ts` exercise the
client/socket boundaries; `e2e/trusted-proxy.ts`, its regression test, the room
helpers, affected E2E specs, and Playwright configuration isolate independent
browser contexts through a real test-only trusted proxy; this report retains
completion evidence.

## TDD evidence

The interrupted implementation recorded these verified RED/GREEN cycles:

1. `pnpm vitest run __tests__/session-auth.test.ts` was RED for body identity
   claims, cookie reuse, malformed cookies, auth limiting, and production
   fallback-secret behavior; it was GREEN at 5/5 after the minimal changes.
2. `pnpm vitest run __tests__/rate-limit.test.ts __tests__/room-handler.test.ts lib/__tests__/store.test.ts __tests__/server.test.ts` was RED for trusted
   forwarding, the missing command limiter, rate-rejection refresh behavior,
   and stale local identity; it was GREEN at 72/72 after implementation.
3. `pnpm vitest run __tests__/server.test.ts` was GREEN at 9/9 for rejected
   unauthenticated/malformed handshakes and log redaction.

Recovery verification reran the public focused set and the full suite below.
The worker build regression was reproduced under `pnpm build`; its existing
route tests remained GREEN after the minimal Node `URL` constructor change,
then the build was GREEN.

## Dependency resolution and audit

`pnpm install --frozen-lockfile` resolved the final lockfile unchanged. The
final direct versions are Next.js, `@next/env`, and `eslint-config-next`
16.3.4; PostCSS 8.5.26; UUID 13.0.2 (from `^13.0.1`). The final pnpm overrides
are `@babel/core` 7.29.6, brace-expansion 1.1.18, browserslist 4.28.8,
Engine.IO 6.6.9, esbuild 0.28.1, minimatch 3.1.4, nanoid 3.3.18, PostCSS
8.5.26, Socket.IO parser 4.2.7, Undici 7.29.0, and ws 8.21.3.

The registry confirmed each selected version exists. The Next.js 16.3.4 update
is a maintained patch/minor choice above the [16.2.11 Active LTS security
floor](https://nextjs.org/blog); the Undici 7.29.0 choice follows the Node 24
[security release guidance](https://github.com/nodejs/nodejs.org/blob/main/apps/site/pages/en/blog/vulnerability/july-2026-security-releases.md).

Fresh `pnpm audit --prod --json` initially returned 4 findings: high
minimatch 3.1.3 through `yt-search` ([GHSA-23c5-xmqv-rm74](https://github.com/advisories/GHSA-23c5-xmqv-rm74)), moderate direct uuid 13.0.0
([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)), low
esbuild 0.27.4 through `tsx` ([GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)), and low Babel core 7.29.0 through
Next ([GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8)).
All had compatible patch fixes and were updated. Final audit exit code is 0:
0 critical, 0 high, 0 moderate, 0 low (315 production dependencies).

No current production-audit advisory remains for `yt-search`. Its fallback
still executes in a 5-second worker boundary in
`app/api/youtube/search/route.ts`; this limits an individual scrape failure or
stall but does not make a future `yt-search` advisory unreachable. The Google
API path remains preferable for production traffic.

## Browser/auth evidence and concerns

`pnpm exec playwright test e2e/multiplayer-room.spec.ts --grep "reconnects
without duplicates" --workers=1` passed (1/1, 45.3s). It uses genuine
`/api/auth/session` issuance, an HttpOnly cookie, Socket.IO reconnection, and
room ownership recovery; no browser globals or fabricated identity were used.

The original combined deterministic run exposed the intended 10-per-60-second
auth boundary after ten same-localhost sessions. The fixture now starts the app
behind `e2e/trusted-proxy.ts`: every independently created browser context has
a random marker; the proxy strips any incoming forwarding header and assigns a
stable, unique `203.0.113.x` address only for a valid marker. Invalid or absent
markers are forwarded without a synthetic address. Only the test backend enables
`TRUST_PROXY=true`; production defaults remain unchanged. The focused resolver
regression is green, and the required combined command now passes 5/5 in 1.8m.

## Round 1 correction evidence

Round 1 repaired the reviewed critical and important findings without changing
the approved production windows or browser UX.

- The initial RED command,
  `pnpm vitest run __tests__/youtube-search-worker.test.ts __tests__/rate-limit.test.ts app/api/youtube/search/__tests__/route.test.ts app/api/youtube/playlist/__tests__/route.test.ts --reporter=verbose`,
  failed as intended: the generated worker boundary was not exported, direct
  App-Route client identity was `unknown`, and search/playlist used bare shared
  limiter keys. The GREEN rerun with metadata included passed 5 files / 32
  tests. The real-worker test constructs `worker_threads.Worker` from the same
  generated data URL used by production and confirms its ESM/CommonJS bridge
  reaches its deterministic ready message.
- The initial production integration run established the new real HTTP
  issuance/origin/N=25 paths and exposed only an unsupported Vitest matcher
  after all 25 connections had succeeded. Replacing that assertion with the
  supported set-size check made
  `pnpm vitest run __tests__/socket-env-order.test.ts __tests__/server.test.ts --reporter=verbose`
  GREEN at 2 files / 13 tests in 31.76s. It covers a production-configured
  custom server, an HTTP-issued cookie admitted by Socket.IO, allowed polling,
  allowed WebSocket, and missing/malformed/rejected origins, plus 25
  independently issued sessions with distinct trusted addresses.
- `__tests__/socket-env-order.test.ts` confirms importing socket modules before
  a production secret is present does not fail; resolving setup after the safe
  fixture supplies the secret verifies its token. `setupSocketAuth` now resolves
  once at Socket.IO setup and command handlers resolve once per socket, not on
  every command.
- `server.ts` overwrites the private `x-syncwatch-client-ip` header from the
  direct TCP peer before Next App Routes run. Direct routes therefore use the
  peer rather than a global `unknown` bucket, while `TRUST_PROXY=true` remains
  the sole path that uses sanitized forwarding. The production server test
  proves a spoofed inbound private header cannot choose the auth bucket.
- Metadata, YouTube search, and playlist now use the independent stable keys
  `api:metadata:`, `api:youtube-search:`, and `api:youtube-playlist:`.

Round 1 changed only the worker, auth/bootstrap/IP and API limiter boundaries,
their tests, and this report. It did not alter rate windows, origin policy,
Redis behavior, or E2E fixture policy.

Production deployment must provide `JWT_SECRET`, canonical
`NEXT_PUBLIC_APP_URL`, TLS, and—only where a proxy sanitizes forwarded
headers—`TRUST_PROXY=true`. Without Redis, local limits and room state are
process-local and cannot enforce shared limits across instances.

## Documentation and final checks

`.env.example` now uses non-secret placeholders, adds production JWT/origin and
trusted-proxy settings, and removes the misleading publishable-looking service
role example. README now specifies Node 24+, Redis-optional/process-local
semantics, last-writer-wins playback, session/origin behavior, exact windows,
and the worker limitation.

| Check                                                                                             | Result                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                  | pass                                                                                                                                |
| task focused Vitest set                                                                           | pass, 6 files / 44 tests; server lifecycle test took 31.5s                                                                          |
| `pnpm vitest run __tests__/session-auth.test.ts`                                                  | pass, 5/5                                                                                                                           |
| `pnpm vitest run __tests__/server.test.ts`                                                        | pass, 9/9 (31.5s)                                                                                                                   |
| `pnpm vitest run __tests__/trusted-proxy.test.ts`                                                 | pass, 1/1 after RED import failure                                                                                                  |
| `pnpm test`                                                                                       | pass, 49 files / 437 tests (Round 1)                                                                                                |
| `pnpm typecheck`                                                                                  | pass                                                                                                                                |
| `pnpm lint`                                                                                       | pass                                                                                                                                |
| `pnpm build`                                                                                      | pass after the worker URL fix                                                                                                       |
| `pnpm audit --prod --json`                                                                        | pass, 0 advisories                                                                                                                  |
| `pnpm exec playwright test e2e/multiplayer-room.spec.ts e2e/degraded-network.spec.ts --workers=1` | pass, 5/5 (Round 1: 1.5m)                                                                                                           |
| `git diff --check`                                                                                | pass                                                                                                                                |
| `pnpm exec prettier --check .`                                                                    | fails on 97 repository files, including pre-existing formatting outside Task 8; scoped files are formatted separately before commit |
| Round 1 focused Vitest command                                                                    | pass, 9 files / 52 tests (32.30s)                                                                                                   |
| Round 1 production server + env-order test                                                        | pass, 2 files / 13 tests (31.76s); includes current N=25 admission                                                                  |
| Round 1 `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm audit --prod --json`                   | pass; audit has 0 advisories; build keeps the pre-existing non-fatal npm-config warnings                                            |
