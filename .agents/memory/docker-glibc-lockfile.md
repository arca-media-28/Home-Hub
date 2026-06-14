---
name: Self-hosted Docker must use glibc base image
description: Why the Dockerfile for self-hosted deploys must use node:*-slim (Debian/glibc), not Alpine (musl)
---

# Self-hosted Docker base image must be glibc, not Alpine

The Replit pnpm-monorepo template's `pnpm-lock.yaml` has a large `overrides:`
block that sets every platform-specific native binary EXCEPT the build host's to
`'-'` (excluded). The Replit host is **glibc x64**, so only the `*-linux-x64-gnu`
variants are kept (rollup, lightningcss, @tailwindcss/oxide, esbuild, etc.); all
`*-musl*` and other-arch variants are stripped.

**Why this matters:** with `pnpm install --frozen-lockfile`, pnpm can only install
what the lockfile resolves. On an **Alpine (musl)** base image the musl native
binaries are excluded in the lockfile, so they can never install. Symptom chain
when building on Alpine: `better-sqlite3` tries to compile (no musl prebuild) →
after adding python3/make/g++ it gets past that, then rollup dies with
`Cannot find module @rollup/rollup-linux-x64-musl`, and lightningcss/oxide would
fail next. Each "fix" just exposes the next musl casualty.

**How to apply:** for any self-hosted Docker build of this repo, use a **glibc**
base image — `node:20-slim` (Debian) — in every stage, NOT `node:*-alpine`. Then
the gnu/x64 binaries the lockfile locks to match the runtime and everything
installs. Use `apt-get install -y --no-install-recommends python3 make g++` (not
`apk add`). On glibc, `better-sqlite3` also finds a prebuilt binary so native
compilation is usually skipped entirely (build tools kept only as insurance).

Do NOT try to fix this by editing the lockfile overrides or adding
`supportedArchitectures` — the template regenerates/strips them, and matching the
lockfile's existing glibc binaries via the base image is far more robust.
