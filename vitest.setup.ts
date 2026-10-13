// @testing-library/jest-dom v7's plain entrypoint assumes a global `expect`
// (e.g. Jest, or Vitest with `test.globals: true`). This project's vitest.config.ts
// does not set `globals: true`, so the plain import throws `expect is not defined`
// at setup time (observed while running `npx vitest run`). The `/vitest` subpath
// extends Vitest's own `expect` directly and works without global injection.
import "@testing-library/jest-dom/vitest"

// @testing-library/react's auto-cleanup registers via `afterEach` only when it
// detects that global on `globalThis` (Jest-style globals). This config does not
// set `test.globals: true`, so without this explicit call the DOM from one test
// leaks into the next (observed as `getByText` matching duplicate nodes across
// tests while running `npx vitest run`).
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

afterEach(() => {
  cleanup()
})
