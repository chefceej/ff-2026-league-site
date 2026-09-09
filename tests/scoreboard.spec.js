const { test, expect } = require("@playwright/test");
const { useFixture, useWeekFixtures, loadWeekFixture } = require("./fixture");

const PAGES = ["/index.html", "/scoreboard.html", "/position.html"];

test.describe("Scoreboard nav link", () => {
  for (const url of PAGES) {
    test(`sits between Standings and Position on ${url}`, async ({ page }) => {
      await useFixture(page);
      await useWeekFixtures(page, { 14: loadWeekFixture("final") });
      await page.goto(url);

      await expect(page.locator(".header-nav .nav-link")).toHaveText(
        ["Standings", "Scoreboard", "Position & Score Analysis"]);
      await expect(page.locator('.header-nav a[href="scoreboard.html"]'))
        .toHaveCount(1);
    });
  }

  test("is the active link on the Scoreboard itself", async ({ page }) => {
    await useFixture(page);
    await useWeekFixtures(page, { 14: loadWeekFixture("final") });
    await page.goto("/scoreboard.html");

    await expect(page.locator(".header-nav .nav-link.active")).toHaveText(
      "Scoreboard");
  });
});
