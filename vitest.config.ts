import { resolve } from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, ".") }, // mirrors tsconfig.json paths: { "@/*": ["./*"] }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"], // imports @testing-library/jest-dom
    include: ["lib/**/*.test.ts", "store/**/*.test.ts", "components/**/*.test.tsx"],
  },
})
