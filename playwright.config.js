// Playwright config: runs the suite against the same static server the README
// documents, so the tests exercise the site exactly as GitHub Pages serves it.
const { defineConfig, devices } = require("@playwright/test");

// One test server per checkout, on a port of its own. `reuseExistingServer`
// only checks that *something* answers the URL, so a port shared between the
// main checkout and a worktree would quietly run one tree's suite against the
// other tree's docs/ -- a green run proving nothing. Deriving the port from
// this file's own directory keeps each checkout stable and distinct, and well
// clear of the 8080 the README documents for serving the site by hand.
const { createHash } = require("crypto");
const PORT = Number(process.env.FF_TEST_PORT) ||
  8100 + parseInt(createHash("sha1").update(__dirname).digest("hex").slice(0, 4), 16) % 400;

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
    stderr: "ignore",
  },
});
