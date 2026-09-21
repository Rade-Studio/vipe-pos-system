# Tasks: P4 — Build & Infrastructure Safety

## Phase Goal
Make TypeScript and ESLint blocking build gates; add CI workflow; harden containers (non-root, pnpm); make `app` service wait for `realtime` healthy; rename project to `vipe-pos-system`; rewrite `README.md` to point at `supabase db reset`.

## PR Slice Recommendation
- **One PR** (P4). Estimated ~210 changed lines, under the 400-line budget.
- **Branch base**: `main` per `stacked-to-main`. PR branch: `sdd/revision-completa-sistema/p4-build-infra`.
- P4 is fully independent of P1/P2/P3 — can be merged in any order relative to them.

## Tasks

### T4-01 — Create `.github/workflows/ci.yml` with typecheck/lint/build jobs
- **description**: New workflow runs on `push` to `main` and every `pull_request`. Three jobs: `lint` (`pnpm install --frozen-lockfile && pnpm lint`), `typecheck` (`pnpm install --frozen-lockfile && pnpm tsc --noEmit`), `build` (`pnpm install --frozen-lockfile && pnpm build`). Uses `pnpm/action-setup@v4` + `actions/setup-node@v4` with Node 20 and pnpm caching. Adds `pos-deps-check` job that runs `pip install -r pos/requirements.txt --dry-run` on Python 3.11 (per Q4-A).
- **touches**: [`.github/workflows/ci.yml`]
- **command**: Open a feature branch with a deliberate `@ts-expect-error` (no matching error) → CI `typecheck` job fails.
- **acceptance_criteria**: [a] workflow file present; [b] three jobs (`lint`, `typecheck`, `build`) + optional `pos-deps-check`; [c] failure on type error blocks PR merge.
- **depends_on**: []
- **size_lines_estimate**: ~70 lines
- **commit_split_hint**: Single commit: `ci: add GitHub Actions workflow (lint/typecheck/build)`.
- **spec_refs**: R4-03 / S4-04.

### T4-02 — Set `next.config.mjs` flags to false + add `outputFileTracingRoot`
- **description**: Edit `next.config.mjs`: `typescript.ignoreBuildErrors = false`, `eslint.ignoreDuringBuilds = false`, add `experimental.outputFileTracingRoot: '/app'` (fixes HS-36 hostname binding). Pre-flight `pnpm lint:fix` once before opening the PR to absorb any current lint debt; document the cleanup in the PR description.
- **touches**: [`next.config.mjs`]
- **command**: `pnpm lint` (exit 0 after pre-flight fix), `pnpm tsc --noEmit` (exit 0), `pnpm build` (exit 0). Then introduce an `@ts-expect-error` without a matching error → `pnpm tsc --noEmit` exits 1.
- **acceptance_criteria**: [a] both flags set to `false`; [b] `outputFileTracingRoot` present; [c] deliberate type error blocks build.
- **depends_on**: [T4-01]
- **size_lines_estimate**: ~10 lines (next.config.mjs is small)
- **commit_split_hint**: Single commit: `fix(build): enable tsc + eslint as blocking gates`.
- **spec_refs**: R4-01, R4-02 / S4-01, S4-02, S4-03.

### T4-03 — Non-root `USER` + pnpm in `Dockerfile` + `.dockerignore`
- **description**: Edit `Dockerfile`: add `RUN apk add --no-cache libc6-compat curl && adduser -D appuser`, switch `npm install --legacy-peer-deps` to `corepack enable && pnpm install --frozen-lockfile`, set `ARG/ENV NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` so the build doesn't bake in localhost, add `USER appuser` before `CMD`. Create `.dockerignore` excluding `node_modules`, `.next`, `.git`, `pos/dist`, `pos/build`, `*.log`. Fixes HS-14, HS-17.
- **touches**: [`Dockerfile`, `.dockerignore`]
- **command**: `docker build -t vipe-pos-test . && docker run --rm vipe-pos-test id` → output shows `uid=1000(appuser)`. `docker build --no-cache -t test .` finishes without `--legacy-peer-deps` warnings.
- **acceptance_criteria**: [a] `id` inside container shows non-root UID; [b] `pnpm` in build steps; [c] `.dockerignore` excludes `node_modules` + `.next` + `.git`.
- **depends_on**: []
- **size_lines_estimate**: ~40 lines (Dockerfile rewrite + .dockerignore)
- **commit_split_hint**: Single commit: `build(docker): non-root user + pnpm + .dockerignore`.
- **spec_refs**: R4-04, R4-05 / S4-05, S4-06, S4-07.

### T4-04 — `docker-compose.yml` `app` waits for `realtime` healthy
- **description**: Edit `docker-compose.yml` `app` service: `depends_on: realtime: { condition: service_healthy }`. Add `/api/health` route in `app/api/health/route.ts` that calls `supabase.auth.getSession()` and returns 200/503. Update `app` healthcheck to use the new route. Fixes HS-29.
- **touches**: [`docker-compose.yml`, `app/api/health/route.ts`]
- **command**: `docker compose down -v && docker compose up -d`; `docker compose ps` shows `realtime` reaches `(healthy)` BEFORE `app` reaches `(healthy)`. `curl -fsS http://localhost:3000/api/health` returns 200.
- **acceptance_criteria**: [a] `app` does not start until `realtime` is healthy; [b] `/api/health` returns 200 only when `auth.getSession()` succeeds.
- **depends_on**: []
- **size_lines_estimate**: ~30 lines
- **commit_split_hint**: Single commit: `fix(compose): app waits for realtime healthy + /api/health route`.
- **spec_refs**: R4-06 / S4-08.

### T4-05 — Rename `package.json` to `vipe-pos-system` + add `lint:fix`/`typecheck`/`test` scripts
- **description**: Change `"name": "my-v0-project"` → `"name": "vipe-pos-system"`. Add scripts: `lint:fix: "next lint --fix"`, `typecheck: "tsc --noEmit"`, `test: "echo 'Add tests here' && exit 0"`. Fixes HS-31.
- **touches**: [`package.json`]
- **command**: `grep '"name"' package.json` → `vipe-pos-system`. `pnpm typecheck` exits 0.
- **acceptance_criteria**: [a] name field updated; [b] scripts present and runnable.
- **depends_on**: []
- **size_lines_estimate**: ~10 lines
- **commit_split_hint**: Single commit: `chore(pkg): rename to vipe-pos-system + add lint:fix/typecheck/test scripts`.
- **spec_refs**: R4-7 / S4-09.

### T4-06 — Rewrite `README.md` to point at `supabase db reset` + add ADR note for required status checks
- **description**: Remove the 9 references to missing `.sql` files (HS-34). Replace with `docker compose up -d && supabase db reset && pnpm docker:dev:seed`. Document that `pnpm tsc --noEmit` and `pnpm lint` are required CI status checks (must be enabled in GitHub repo settings — ADR note per Q4-B). Document the `pos/` Python setup with `pip install -r pos/requirements.txt`.
- **touches**: [`README.md`, `docs/adr/0001-ci-required-status-checks.md`]
- **command**: `grep "create-database-schema.sql\|create-storage-bucket.sql\|create-business-config-table.sql" README.md` → zero matches. `grep "supabase db reset" README.md` → matches.
- **acceptance_criteria**: [a] no references to missing SQL files; [b] setup sequence correct; [c] ADR note present.
- **depends_on**: []
- **size_lines_estimate**: ~60 lines (README rewrite + ADR)
- **commit_split_hint**: Single commit: `docs(readme): replace missing .sql refs with supabase db reset + ADR for CI`.
- **spec_refs**: — (resolves HS-34 from exploration).

### T4-07 — Phase verification smoke harness
- **description**: Add `pnpm verify:p4` that runs `pnpm lint && pnpm tsc --noEmit && pnpm build` to prove the gates are now blocking. Also runs `docker build -t vipe-pos-test .` and `docker run --rm vipe-pos-test id` to prove non-root.
- **touches**: [`package.json`]
- **command**: `pnpm verify:p4`.
- **acceptance_criteria**: [a] lint, typecheck, build all pass; [b] `docker run ... id` shows non-root UID.
- **depends_on**: [T4-01, T4-02, T4-03, T4-04, T4-05, T4-06]
- **size_lines_estimate**: ~15 lines
- **commit_split_hint**: Single commit: `chore(verify): add p4 smoke harness`.
- **spec_refs**: R4-01, R4-02, R4-04 / S4-01, S4-03, S4-05.

## Verification (apply agent will run)
```
pnpm verify:p4
# Expect: lint OK, tsc OK, build OK, docker id shows non-root
# Expect: opening a PR with @ts-expect-error (no match) → CI fails typecheck
```

## Known environmental failures
- The pre-flight `pnpm lint:fix` may surface a large amount of existing lint debt (likely 50+ `any` casts and unused imports). Document any remaining lint debt as a follow-up issue rather than blocking P4.
- `pnpm build` requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars; CI passes them via secrets (per workflow file).
- Docker build context may be > 1 GB without `.dockerignore` — T4-03 must land before T4-07 is runnable in CI.

## Rollback Plan
1. `git revert <merge-sha>` — reverts workflow + next.config + Dockerfile + compose + package.json + README in one commit.
2. Surgical: delete `.github/workflows/ci.yml`; revert `next.config.mjs` flags; revert `Dockerfile USER` directive.

## Out-of-phase items
- Hardening `docker-compose.prod.yml` (no reverse proxy, no SSL, no rate limiting) — explicitly deferred.
- Replacing `legacy-peer-deps` flag in `package.json` (resolved via pnpm migration).
- Adding a per-PR preview deploy (out of scope).
- Migrating `pos/` to pnpm workspaces (out of scope per deferred list).
