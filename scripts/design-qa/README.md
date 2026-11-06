# Design QA

`qa.mjs` screenshots a gentle-design artboard (`design/<slug>/*.html`) at phone, tablet and desktop sizes in light and dark, and reports overflow (content escaping its box or the viewport) in `report.json`.
Run: `pnpm qa:design design/<slug>/01-x.html [outDir] [--viewports=390x844,1440x900] [--themes=light,dark]`. Chromium from `CHROME_BIN` or the Playwright cache; Node built-ins only.
Mark decorative bleed or intentional scrollers with `data-qa-ignore`. Exit 0 = no issues, 1 = issues, 3 = watchdog.
Its `CHECK` expression is reused by `scripts/smoke/app-screens.mjs` for the running app.
