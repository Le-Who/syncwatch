# Preserve build environment constraints

SyncWatch uses pnpm's hoisted node linker because the Northflank buildpack's
cache layout prevented Turbopack from resolving Next.js through pnpm's default
symlinks. The hoisted layout keeps those packages resolvable during deployment.
The original change is recorded in commit `9b57b2c`.

In Webpack development sessions, `DISABLE_HMR=true` disables file watching to
prevent AI Studio from refreshing the page while an agent writes files.

Knip exempts `tailwindcss` from unused-dependency reporting because
`app/globals.css` loads it through a CSS import.
