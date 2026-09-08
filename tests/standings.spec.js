const { test, expect } = require("@playwright/test");
const { useFixture } = require("./fixture");

const rows = page => page.locator("#standings-table tbody tr");

test.describe("Standings table", () => {
  test("renders one row per team, in fixture order, with team names", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    await expect(rows(page)).toHaveCount(data.teams.length);
    await expect(page.locator("#standings-table tbody td.team"))
      .toHaveText(data.teams.map(t => t.team_name));
  });

  test("keeps rank, manager, points and norm cells and the cutoff stripe", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    const row = rows(page).first();
    const first = data.teams[0];
    await expect(row.locator("td").first()).toHaveText(String(first.rank));
    await expect(row.locator("td.mgr")).toHaveText(first.owner);
    await expect(row.locator("td.norm")).toHaveText(
      (n => (n > 0 ? "+" : "") + n)(first.normalized_by_week.at(-1))
    );

    const cutoff = data.metadata.playoff_cutoff;
    await expect(rows(page).nth(cutoff - 1)).toHaveClass(/cutoff/);
    await expect(page.locator("#standings-table tbody tr.cutoff")).toHaveCount(1);
  });
});
