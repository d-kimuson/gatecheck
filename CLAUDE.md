## Project Overview

gatecheck: CLI tool that sets quality gates on git changes — runs deterministic checks (lint, typecheck, test) and AI-powered reviews against changed files.
Single-package repo, no monorepo.

## Tech Stack

- Runtime: Node.js 24+
- Language: TypeScript (strictest tsconfig)
- Build: tsdown
- Lint: oxlint (type-aware) + oxfmt
- Test: vitest
- Dependencies: commander, valibot, yaml

## Commands

- `pnpm cli` — Run CLI without building (tsx)
- `pnpm test` — Run tests
- `pnpm typecheck` — Type-check
- `pnpm lint` — Lint + format check
- `pnpm fix` — Auto-fix lint + format
- `pnpm build` — Build to dist/

## Key Conventions

- Arrow functions only (`const fn = () => {}`)
- No `as` type assertions, no `is` type guards
- `as const satisfies` for constant objects
- No `console.log` — use `log`/`logError` from `src/logger.ts` (oxlint no-console rule)
- Discriminated unions for ADTs (see `CheckResult`, `ReviewResult`, `ChangedSource` in `src/types.ts`)
- Pre-commit hook via lefthook: runs oxlint + oxfmt on staged files

## Architecture

- `src/bin.ts` — CLI entrypoint (commander): `gatecheck check` / `gatecheck review`
- `src/types.ts` — Type definitions (ADTs): CheckEntry, ReviewEntry, CheckResult, ReviewResult
- `src/config.ts` — YAML config loading (`gatecheck.yaml`) + valibot schema
- `src/template.ts` — Template engine (`{{ scope.KEY }}`) with env/match/ctx/vars scopes
- `src/git.ts` — Git diff → file list + diff summary
- `src/matcher.ts` — Regex matching with named groups + exclude support
- `src/runner.ts` — Check/review execution, fallbacks, dry-run, reporting
- `src/logger.ts` — stdout/stderr output helpers
