const { test, expect } = require("@playwright/test");
const { useFixture } = require("./fixture");

const dropSeason = data => { delete data.metadata.season; return data; };

test.describe("Season label", () => {
  test("leads the Standings subtitle, ahead of the team and week counts", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    const meta = data.metadata;
    await expect(page.locator("#subtitle")).toHaveText(
      `${meta.season} season · ${meta.num_teams}-team league ` +
      `· normalized so #${meta.playoff_cutoff} = 0 · ${meta.completed_weeks} weeks played`);
  });

  test("appears on the Position & Score Analysis subtitle too", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/position.html");

    await expect(page.locator("#last-updated"))
      .toContainText(`${data.metadata.season} season`);
  });

  test("leaves the Standings footer timestamp where it was", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    await expect(page.locator("footer #updated"))
      .toHaveText(`Updated ${data.metadata.updated_at}`);
  });

  test("keeps the Position page's updated timestamp", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/position.html");

    await expect(page.locator("#last-updated"))
      .toContainText(`updated ${data.metadata.updated_at}`);
  });

  test("is omitted, not printed as undefined, when the metadata has no season",
    async ({ page }) => {
      await useFixture(page, dropSeason);

      await page.goto("/index.html");
      const standings = page.locator("#subtitle");
      await expect(standings).toContainText("-team league");
      await expect(standings).not.toContainText("season");
      await expect(standings).not.toContainText("undefined");

      await page.goto("/position.html");
      const position = page.locator("#last-updated");
      await expect(position).toContainText("Points by position");
      await expect(position).not.toContainText("season");
      await expect(position).not.toContainText("undefined");
    });
});
