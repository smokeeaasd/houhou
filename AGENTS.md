# houhou — Agent Guide

## Stack

- TypeScript 7.0.2, tsdown 0.22.12 (Rolldown), oxlint 1.74.0, oxfmt 0.59.0, Vitest 4.1.10, pnpm 11.15.1
- ESM-only (`"type": "module"`), output `dist/` (`.mjs` + `.d.mts`)

## Commands

| Step      | Command                                                |
| --------- | ------------------------------------------------------ |
| Install   | `pnpm install`                                         |
| Typecheck | `pnpm typecheck` (uses `tsconfig.test.json`)           |
| Lint      | `pnpm lint` / `pnpm lint:fix`                          |
| Format    | `pnpm format` / `pnpm format:check`                    |
| Test      | `pnpm test` / `pnpm test:watch` / `pnpm test:coverage` |
| Build     | `pnpm build`                                           |
| Dev       | `pnpm dev` (tsdown --watch)                            |

Run `lint → typecheck → test` before push. Pre-push hook enforces `typecheck + test`.

## CI / Release

- **CI** on push/PR to `main`: 3 parallel jobs — `Quality` (typecheck + lint + format:check + commitlint), `Test`, `Build`.
- **Release** on `v*` tag: `pnpm build && pnpm publish --provenance`.
- `pnpm-workspace.yaml` has `gitChecks: false` — publish skips git checks.

## Architecture

- Single package, no monorepo. Tests in `tests/houhou.test.ts` only.
- Entry `src/index.ts` → exports `task`, error classes, and types.
- Policies under `src/policies/` — each is an independent wrapper around an async function.
- `isolatedDeclarations: true` + `erasableSyntaxOnly: true` → explicit return types on all exports, no `enum`/`namespace`.
- `verbatimModuleSyntax: true` → `import type` required for type-only imports.
- `noUncheckedIndexedAccess: true` → index access returns `T | undefined`.
- Policy lock prevents double config: compile-time via `Omit` + runtime via `Set`.
- Input validation `attempts`, `failureThreshold`, `successThreshold`, `ms` throw `RangeError` if < 1.

## Public API

All from `src/index.ts`:

| Export                    | Kind      | Source          |
| ------------------------- | --------- | --------------- |
| `task`                    | function  | `src/task.ts`   |
| `Task`                    | type      | `src/types.ts`  |
| `RetryOptions`            | interface | `src/types.ts`  |
| `CircuitBreakerOptions`   | interface | `src/types.ts`  |
| `TaskTimeoutError`        | class     | `src/errors.ts` |
| `CircuitBreakerOpenError` | class     | `src/errors.ts` |

## Code Style

- Lint: oxlint with `typescript`, `unicorn`, `import`, `promise`, `oxc` plugins.
- Format: oxfmt — no semicolons, single quotes, no trailing commas, LF line endings, 100 print width.
- `pre-commit` hook: `lint-staged` runs `oxlint --fix && oxfmt --write` on staged `*.ts`.
- `commit-msg` hook validates conventional commits.

## Conventions

- Conventional commits in English (e.g., `feat:`, `fix:`, `docs:`, `ci:`).
- Branch from `main`, squash-merge PR, delete branch.
- `vitest` globals enabled — `describe`, `it`, `expect` available without import.
- `retry(n)` shorthand is sugar for `retry({ attempts: n })`.
- `task(name?, fn)` → `task(fn)` — name removed; it was only cosmetic in error messages.
