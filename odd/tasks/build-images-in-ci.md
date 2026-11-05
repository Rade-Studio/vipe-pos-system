# Feature: build-images-in-ci

Cross-repository: build every VPS app's Docker images in GitHub Actions and push them to GHCR, so Coolify on rade-vps only pulls and runs them.
Coordinating document lives in vipe-pos-system; each repository gets its own branch `ci/build-images` and PR. Engram mirror: `odd/build-images-in-ci/tasks`.

## Specs

- **S1** Scope: "si, de todas" (answer to "construir las imágenes en GitHub Actions ... ¿Lo hago?"), clarified as "Todas las apps de la VPS"
  -> every app that Coolify builds from source on rade-vps is built in GitHub Actions instead: vipe-pos-system, fadely, mapanetbpo-app, dqfinance, printing-cost-app, rade-studio, threedcalculator, server-wayne.
- **S2** Why: builds on the VPS fill its swap (4048 of 4095 MiB after a vipe-pos build) next to the other production apps
  -> after the change, a deploy on the VPS only pulls images; no `docker build`, `nixpacks` or compose `build:` runs on the server.
- **S3** No regression: each app keeps its domains, runtime environment, data and deploy trigger; staging first, then one production at a time, each verified, with an immediate rollback (rebuild on the server or redeploy the previous image tag).
- **S4** Secrets: build-time secrets (for example mapanetbpo's Composer deploy key) never end up in an image layer or in logs; the server pulls with a registry credential the user provides; no credential is committed.

## Tasks

- [ ] B0. Server: authenticate Docker on rade-vps to ghcr.io (user runs the documented `gh auth token | ssh ... docker login` command); verify a private pull. (S4) Route: user + parent. Commit: n/a.
- [ ] B1. vipe-pos-system pilot (S1-S4): CI builds and pushes `api`, `migrate`, `web` images (`:sha`, `:dev`/`:main`); `docker-compose.coolify.yml` uses `image:` with `pull_policy: always`; staging deploy pulls; verify + smoke. Route: worker + parent (server). Commit: pending.
  - Evidence (worker, 2026-11-05): `docker-build` pushes `ghcr.io/rade-studio/vipe-pos-{api,migrate,web}:{sha,dev|main}` on push only (`packages: write` on that job), `deploy` needs it; Coolify compose uses `image: ...:${VIPE_IMAGE_TAG:?}` + `pull_policy: always`, no `build:`; `vitest run lib/docs/deploy-docs.test.ts` 13/13 after 3 RED; documented validation exits 0 with `VIPE_IMAGE_TAG`, 1 without; local `docker build` of targets api/migrate and root Dockerfile OK, hygiene OK; no build args or secrets needed. Pending: B0 login, staging deploy, smoke.
- [ ] B2. fadely (S1-S4): review existing `docker.yml`; images for the compose services; staging then production. Route: worker + parent. Commit: pending.
- [ ] B3. mapanetbpo-app (S1-S4): Dockerfile image with the Composer key as a BuildKit secret; staging, dev-generico, then production. Route: worker + parent. Commit: pending.
- [ ] B4. dqfinance (S1-S3): Dockerfile image; production. Route: worker + parent. Commit: pending.
- [ ] B5. printing-cost-app (S1-S3): Nixpacks build moved to CI (Dockerfile or nixpacks in CI), `NEXT_PUBLIC_API_URL` at build; production. Route: worker + parent. Commit: pending.
- [ ] B6. rade-studio (S1-S3): check branch `ci/deploy-on-runner`; Dockerfile image; staging then production. Route: worker + parent. Commit: pending.
- [ ] B7. threedcalculator (S1-S3): `ThreeDCalculator/Dockerfile` image; production. Route: worker + parent. Commit: pending.
- [ ] B8. server-wayne (S1-S3): minecraft image extending itzg; production (game server, coordinate a quiet window). Route: worker + parent. Commit: pending.

## Log

- L1 (user, 2026-11-05): asked "Recomiendo construir las imágenes en GitHub Actions ... ¿Lo hago?", the user answered "si, de todas"; asked what "de todas" means, the user chose "Todas las apps de la VPS".
- L2 (user, 2026-11-05): registry access: "Hazlo con mi sesión de gh". The parent does not copy the token; the user runs `gh auth refresh -h github.com -s read:packages` and `gh auth token | ssh ... 'docker login ghcr.io -u ahernand53 --password-stdin'`.
- L3 (user, 2026-11-05): clones: "ya los debemos tener clonados". Found under /home/ahernand/projects/ (fadely at barber-app); several on feature branches or dirty, so work happens in worktrees `/home/ahernand/projects/<repo>-worktrees/build-in-ci` from each default branch.
- L4 (evidence, 2026-11-05): Coolify inventory. Apps built on the server: vipe-pos staging (compose) and legacy production (dockerfile); fadely production and staging (compose); mapanetbpo-app production, staging and dev-generico (dockerfile); dqfinance (dockerfile); printing-cost-app (nixpacks); rade-studio production and staging (dockerfile); threedcalculator api (dockerfile, `ThreeDCalculator/Dockerfile`); minecraft (compose from server-wayne). engram-cloud already pulls an image; mapanet-talent is an inline Dockerfile (not a repository). The user has admin on all repositories. Host: 4 CPUs, 7.8 GiB RAM, swap 4035/4095 MiB.
- L5 (evidence, 2026-11-05): fadely, rade-studio, mapanetbpo-app, dqfinance, printing-cost-app and threedcalculator set the repo variable CI_RUNNER=self-hosted. Their runners (el-atari-<repo>, labels self-hosted/Linux/X64/el-atari) run as Docker containers on the user's PC, not on rade-vps (no runner process there). Image builds in those repos therefore use `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}` like their other jobs. vipe-pos-system has no CI_RUNNER and keeps ubuntu-latest. Offline today: el-atari-fadely, el-atari-printing-cost-app, el-atari-threedcalculator; those repos' CI cannot run until their runners are started.
