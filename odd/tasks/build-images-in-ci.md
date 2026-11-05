# Feature: build-images-in-ci

Cross-repository: build every VPS app's Docker images in GitHub Actions and push them to GHCR, so Coolify on rade-vps only pulls and runs them.
Coordinating document lives in vipe-pos-system; each repository gets its own branch `ci/build-images` and PR. Engram mirror: `odd/build-images-in-ci/tasks`.

## Specs

- **S1** Scope: "si, de todas" (answer to "construir las imágenes en GitHub Actions ... ¿Lo hago?"), clarified as "Todas las apps de la VPS"
  -> every app that Coolify builds from source on rade-vps, except mapanetbpo-app (L6), is built in GitHub Actions instead: vipe-pos-system, fadely, dqfinance, printing-cost-app, rade-studio, threedcalculator, server-wayne.
- **S2** Why: builds on the VPS fill its swap (4048 of 4095 MiB after a vipe-pos build) next to the other production apps
  -> after the change, a deploy on the VPS only pulls images; no `docker build`, `nixpacks` or compose `build:` runs on the server.
- **S3** No regression: each app keeps its domains, runtime environment, data and deploy trigger; staging first, then one production at a time, each verified, with an immediate rollback (rebuild on the server or redeploy the previous image tag).
- **S4** Secrets: build-time secrets (for example mapanetbpo's Composer deploy key) never end up in an image layer or in logs; the server pulls with a registry credential the user provides; no credential is committed.

## Tasks

- [x] B0. Server: authenticate Docker on rade-vps to ghcr.io (user runs the documented `gh auth token | ssh ... docker login` command); verify a private pull. (S4) Route: user + parent. Commit: n/a.
- [x] B1. vipe-pos-system pilot (S1-S4): CI builds and pushes `api`, `migrate`, `web` images (`:sha`, `:dev`/`:main`); `docker-compose.coolify.yml` uses `image:` with `pull_policy: always`; staging deploy pulls; verify + smoke. Route: worker + parent (server). Commit: pending.
  - Evidence (worker + parent, 2026-11-05): `docker-build` pushes `ghcr.io/rade-studio/vipe-pos-{api,migrate,web}:<sha>` on push to dev/main only, with GHCR names only (303d78b; native review review-7b7125d364a10c51 required this correction: bare local tags would have been pushed to Docker Hub). The deploy job moves `:dev`/`:main` after every check, without rebuilding, and only while the commit is still the branch head. The Coolify compose pulls `${VIPE_IMAGE_TAG}` with `pull_policy: always`. Docs tests 15/15. The independent verifier proved api and migrate run from the images; the web image is proven by the PR CI build (it needs network for next/font).
- [ ] B2. fadely (S1-S4): review existing `docker.yml`; images for the compose services; staging then production. Route: worker + parent. Commit: pending.
- [-] B3. mapanetbpo-app: excluded by the user (L6); its Coolify apps keep building on the server. Commit: n/a.
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
- L6 (user, 2026-11-05): "y mapanetbpo no lo hagas"
- L7 (evidence, 2026-11-05): B0 done: the user ran the gh token login on rade-vps ("Login Succeeded"). B1 done: PR #101 merged (09d7ae9). Dev CI: docker-build success, the deploy job moved :dev, and Coolify deployment i4eanechoobnsiqdy0pwkavc logged "Pulling image-based services before stopping the current deployment" and "Pulled" for api, migrate and web, with no build steps. The containers run ghcr.io/rade-studio/vipe-pos-{api,web,migrate}:dev; migrate exited 0. Browser smoke: 33 OK pages, realtime 566/360 ms, no console errors.
- L8 (decision, 2026-11-05): the Coolify API cannot switch an existing Dockerfile app to an image build pack (update enum: nixpacks, railpack, static, dockerfile, dockercompose). Dockerfile apps therefore point their Dockerfile location at `deploy/coolify.Dockerfile` (`ARG IMAGE_TAG` / `FROM ghcr.io/rade-studio/<app>:${IMAGE_TAG}`), whose build only pulls the CI image. Order per app: merge the CI change first (one last server build while the image is published), then switch the Dockerfile location and the build-time `IMAGE_TAG`, redeploy, and verify. Rollback is restoring the original Dockerfile location.
