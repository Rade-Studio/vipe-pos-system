# Delta for Build and Infrastructure Safety (P4)

## Purpose

Enable TypeScript and ESLint as blocking build gates; add CI workflow; harden containers (non-root, pnpm); ensure `app` service waits for `realtime` healthy; rename project to `vipe-pos-system`.

## ADDED Requirements

### Requirement: R4-01 — TypeScript Errors Break the Build

`next.config.mjs` MUST set `typescript.ignoreBuildErrors: false`.

Running `pnpm tsc --noEmit` MUST return a non-zero exit code when any `.ts` / `.tsx` file has a type error.

#### Scenario: S4-01 — Type error fails CI build

- GIVEN a developer introduces `@ts-expect-error` without a matching error in `app/page.tsx`
- WHEN `pnpm tsc --noEmit` runs in CI
- THEN the command exits with code 1
- AND the CI build fails

#### Scenario: S4-02 — Strict mode catches type drift

- GIVEN `types/models.ts` disagrees with `types/index.ts` on `Order.status` enum values
- WHEN `pnpm tsc --noEmit` runs
- THEN TypeScript reports the mismatch as an error
- AND the build fails until resolved

### Requirement: R4-02 — ESLint Errors Break the Build

`next.config.mjs` MUST set `eslint.ignoreDuringBuilds: false`.

Running `pnpm lint` MUST return a non-zero exit code when any `.ts` / `.tsx` file has an ESLint error.

#### Scenario: S4-03 — Unused import fails lint in CI

- GIVEN a developer commits `import { unusedFn } from './utils'` without using `unusedFn`
- WHEN `pnpm lint` runs in CI
- THEN the command exits with code 1
- AND the build fails

### Requirement: R4-03 — CI Workflow Runs on Every PR

`.github/workflows/ci.yml` MUST exist and define at minimum:
- `on: [push, pull_request]`
- Jobs: `typecheck` (`pnpm tsc --noEmit`), `lint` (`pnpm lint`), `build` (`pnpm build`)
- All three jobs MUST pass for the workflow to be green

#### Scenario: S4-04 — CI workflow blocks merge on type error

- GIVEN a feature branch introduces a TypeScript error
- WHEN the branch is pushed and a PR is opened
- THEN the CI workflow runs and all three jobs execute
- AND the `typecheck` job fails
- AND the PR cannot be merged

### Requirement: R4-04 — Container Runs as Non-Root

The `Dockerfile` MUST include `USER appuser` (or equivalent) before the `CMD` instruction.

The image MUST NOT have any process running as UID 0.

#### Scenario: S4-05 — Container process UID is not 0

- GIVEN the Docker image is built from the updated Dockerfile
- WHEN `docker run --rm <image> id` is executed
- THEN the output shows a non-root UID (e.g., `uid=1000(appuser)`)

#### Scenario: S4-06 — Dockerfile has USER directive

- GIVEN the Dockerfile is read after P4 is applied
- THEN a line matching `^USER ` appears before any `CMD` or `ENTRYPOINT`
- AND the user `appuser` or `node` is used

### Requirement: R4-05 — Container Uses pnpm

The `Dockerfile` MUST use `pnpm` instead of `npm` for dependency installation.

#### Scenario: S4-07 — pnpm install in container

- GIVEN the Dockerfile is read after P4 is applied
- THEN `pnpm install` (or `pnpm import && pnpm install`) appears in the build steps
- AND `npm install` does not appear

### Requirement: R4-06 — `app` Waits for `realtime` Healthy

`docker-compose.yml` `app` service MUST have `depends_on` with `condition: service_healthy` referencing the `realtime` service.

The `app` healthcheck MUST call `supabase.auth.getSession()` or equivalent to verify the Supabase stack is fully available before reporting healthy.

#### Scenario: S4-08 — app starts only after realtime is healthy

- GIVEN `docker compose up -d` is run from a clean state
- WHEN `docker compose ps` shows all services
- THEN `realtime` reaches `healthy` before `app` transitions to `healthy`
- AND `app` never reports healthy if `realtime` fails

### Requirement: R4-07 — Package Renamed to `vipe-pos-system`

`package.json` `name` field MUST be `"vipe-pos-system"`.

#### Scenario: S4-09 — Package name updated

- GIVEN `package.json` is read after P4 is applied
- THEN `"name": "vipe-pos-system"` is present
- AND `"name": "my-v0-project"` is absent

## MODIFIED Requirements

None — P4 introduces new behavior only.

## NON-FUNCTIONAL REQUIREMENTS

| Aspect | Requirement |
|--------|-------------|
| CI runtime | `pnpm tsc --noEmit` MUST complete within 120 s on a standard GitHub Actions runner |
| Image size | Adding `.dockerignore` MUST reduce the context sent to Docker daemon by > 80% (exclude `node_modules`, `.next`, `.git`, `pos/dist`) |
| Security | Container MUST NOT run as root; no `chmod 777` on any directory |

## MIGRATION / ROLLBACK

All P4 changes are file-level and have no database dependency.

- **Rollback**: delete `.github/workflows/ci.yml`; revert `next.config.mjs` flags; revert `Dockerfile` user directives.
- **No migration needed** for package rename — `package.json` only.

## OUT OF SCOPE

- RLS / multi-tenant schema (P2)
- Payment atomicity (P3)
- Realtime publication (P1)
- React Query migration (P6)
- Printer listener (P5)
