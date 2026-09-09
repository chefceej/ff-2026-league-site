// The way out of the empty state: while no week is final the Standings and
// Position pages have nothing to draw, but the Scoreboard may already be
// previewing the week, and nothing on either page said so.
const { test, expect } = require("@playwright/test");
const { useFixture, truncateToWeeks } = require("./fixture");

const PAGES = [
  { name: "Standings", path: "/index.html" },
  { name: "Position & Score Analysis", path: "/position.html" },
];

/** Kickoff week: Week 1 has a file on the Scoreboard, nothing is final yet. */
function kickoffWeek(data) {
  truncateToWeeks(data, 0);
  data.metadata.week_files = [1];
  data.metadata.current_week = 1;
  return data;
}

/** The preseason: ESPN has served no week of this season at all. */
function preseason(data) {
  truncateToWeeks(data, 0);
  data.metadata.week_files = [];
  data.metadata.current_week = null;
  return data;
}

const link = page => page.locator("#empty-state .preview-link");

for (const pg of PAGES) {
  test.describe(`${pg.name} empty state`, () => {
    test("sends the visitor to the week the Scoreboard is previewing",
      async ({ page }) => {
        await useFixture(page, kickoffWeek);
        await page.goto(pg.path);

        await expect(page.locator("#empty-state")).toBeVisible();
        await expect(link(page)).toBeVisible();
        await expect(link(page)).toContainText("Week 1");
        await expect(link(page).locator("a"))
          .toHaveAttribute("href", "scoreboard.html");
      });

    test("names the week that is actually previewed, not always week 1",
      async ({ page }) => {
        await useFixture(page, data => {
          kickoffWeek(data);
          data.metadata.week_files = [1, 2, 3];
          data.metadata.current_week = 3;
          return data;
        });
        await page.goto(pg.path);

        await expect(link(page)).toContainText("Week 3");
      });

    test("falls back to the last published week, as the Scoreboard does",
      async ({ page }) => {
        // The Scoreboard opens on the most recent week it has a file for when
        // current_week names one nobody wrote, so that is the week to name.
        await useFixture(page, data => {
          kickoffWeek(data);
          data.metadata.week_files = [1, 2];
          data.metadata.current_week = 3;
          return data;
        });
        await page.goto(pg.path);

        await expect(link(page)).toContainText("Week 2");
      });

    test("stays quiet when no week has been published yet",
      async ({ page }) => {
        await useFixture(page, preseason);
        await page.goto(pg.path);

        await expect(page.locator("#empty-state")).toBeVisible();
        await expect(link(page)).toBeHidden();
      });
  });
}
