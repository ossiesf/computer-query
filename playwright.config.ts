import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 20_000,
  use: { baseURL: "http://localhost:5174" },
  webServer: {
    command: "npx vite --mode e2e --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
  },
});
