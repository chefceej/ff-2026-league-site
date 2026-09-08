// Playwright config: runs the suite against the same static server the README
// documents, so the tests exercise the site exactly as GitHub Pages serves it.
const { defineConfig, devices } = require("@playwright/test");

// Same server the README documents, one port over so a dev server already
// running on 8080 is never mistaken for the one under test.
const PORT = 8081;

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --directory docs/`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
  },
});
