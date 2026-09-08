const { test, expect } = require("@playwright/test");
const { useFixture, truncateToWeeks } = require("./fixture");

const rows = page => page.locator("#standings-table tbody tr");

/** What the movement indicator should read, computed from the fixture itself. */
function expectedMovement(teams, completedWeeks) {
  if (completedWeeks < 2) return teams.map(() => "no change");
  const prevOrder = teams
    .map((t, i) => ({ i, pts: t.cumulative_points_by_week[completedWeeks - 2] }))
    .sort((a, b) => b.pts - a.pts || a.i - b.i);
  const prevRank = new Map(prevOrder.map((e, idx) => [e.i, idx + 1]));
  return teams.map((t, i) => {
    const move = prevRank.get(i) - (i + 1);
    if (move > 0) return `up ${move}`;
    if (move < 0) return `down ${-move}`;
    return "no change";
  });
}

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

    const signed = n => (n > 0 ? "+" : "") + n;
    await expect(page.locator("#standings-table tbody td.rk .rk-num"))
      .toHaveText(data.teams.map(t => String(t.rank)));
    await expect(page.locator("#standings-table tbody td.mgr"))
      .toHaveText(data.teams.map(t => t.owner));
    await expect(page.locator("#standings-table tbody td.pts"))
      .toHaveText(data.teams.map(t => String(t.total_ranking_points)));
    await expect(page.locator("#standings-table tbody td.norm"))
      .toHaveText(data.teams.map(t => signed(t.normalized_by_week.at(-1))));

    const cutoff = data.metadata.playoff_cutoff;
    await expect(rows(page).nth(cutoff - 1)).toHaveClass(/cutoff/);
    await expect(page.locator("#standings-table tbody tr.cutoff")).toHaveCount(1);
  });
});

test.describe("Rank movement indicator", () => {
  test("every row's movement matches the fixture's cumulative points", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    expect(data.teams.map((t, i) => t.rank === i + 1)).not.toContain(false);
    const expected = expectedMovement(data.teams, data.metadata.completed_weeks);
    await expect(page.locator("#standings-table tbody td.rk .mv-label"))
      .toHaveText(expected);
    // The season being tested is not a season in which nobody moved.
    expect(expected.some(e => e !== "no change")).toBe(true);
  });

  test("up moves are green, down moves are red, held positions are muted", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    const expected = expectedMovement(data.teams, data.metadata.completed_weeks);
    const cls = { up: "mv up", down: "mv down", "no change": "mv flat" };
    for (const [i, label] of expected.entries()) {
      const key = label.startsWith("up") ? "up" : label.startsWith("down") ? "down" : label;
      await expect(rows(page).nth(i).locator("td.rk .mv")).toHaveClass(cls[key]);
    }
    // Read the color off the indicator itself: deleting the CSS rules must
    // fail this test, which asserting the :root palette would not.
    const rendered = sel => page.locator(sel).first()
      .evaluate(el => getComputedStyle(el).color);
    const resolved = name => page.evaluate(
      n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
    const toRgb = hex => `rgb(${[1, 3, 5]
      .map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
    for (const [sel, token] of [["td.rk .mv.up", "--pos"],
                                ["td.rk .mv.down", "--neg"],
                                ["td.rk .mv.flat", "--mut"]]) {
      expect(await rendered(sel)).toBe(toRgb(await resolved(token)));
    }
  });

  test("shows a glyph and a magnitude alongside the words", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    const expected = expectedMovement(data.teams, data.metadata.completed_weeks);
    const moved = expected.findIndex(e => e !== "no change");
    const glyph = rows(page).nth(moved).locator("td.rk .mv-glyph");
    await expect(glyph).toHaveText(
      new RegExp(`^[▲▼]\\s*${expected[moved].split(" ")[1]}$`));
  });

  test("with one completed week every team reads no change", async ({ page }) => {
    const data = await useFixture(page, d => truncateToWeeks(d, 1));
    await page.goto("/index.html");

    await expect(page.locator("#standings-table tbody td.rk .mv-label"))
      .toHaveText(data.teams.map(() => "no change"));
    await expect(page.locator("#standings-table tbody td.rk .mv.flat"))
      .toHaveCount(data.teams.length);
  });

  test("a tie at the previous week manufactures no movement", async ({ page }) => {
    const TIED_AT = 6; // 0-based index of the first team in the tied pair
    const data = await useFixture(page, d => {
      const n = d.metadata.completed_weeks;
      // Give week N-1 an order identical to the delivered one, then tie two
      // adjacent teams: nothing but the tie can explain any movement.
      d.teams.forEach((t, i) => { t.cumulative_points_by_week[n - 2] = (d.teams.length - i) * 10; });
      d.teams[TIED_AT + 1].cumulative_points_by_week[n - 2] =
        d.teams[TIED_AT].cumulative_points_by_week[n - 2];
      return d;
    });
    await page.goto("/index.html");

    const labels = page.locator("#standings-table tbody td.rk .mv-label");
    await expect(labels).toHaveText(data.teams.map(() => "no change"));
    await expect(labels.nth(TIED_AT)).toHaveText("no change");
    await expect(labels.nth(TIED_AT + 1)).toHaveText("no change");
  });
});

test.describe("Last Wk column", () => {
  test("shows each team's ranking points for the latest completed week", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    const week = data.metadata.completed_weeks;
    await expect(page.locator("#standings-table th.lastwk")).toHaveText(`Wk ${week}`);
    await expect(page.locator("#standings-table th.lastwk"))
      .toHaveAttribute("title", /most recent completed week/i);
    await expect(page.locator("#standings-table tbody td.lastwk")).toHaveText(
      data.teams.map(t => t.ranking_points_by_week[week - 1].toFixed(1))
    );
  });

  test("grows the table by exactly one column", async ({ page }) => {
    const data = await useFixture(page);
    await page.goto("/index.html");

    const COLUMNS_BEFORE = 5; // #, Team, Manager, Points, Norm
    await expect(page.locator("#standings-table thead th")).toHaveCount(COLUMNS_BEFORE + 1);
    for (let i = 0; i < data.teams.length; i++) {
      await expect(rows(page).nth(i).locator("td")).toHaveCount(COLUMNS_BEFORE + 1);
    }
  });

  test("shows week-1 points when only one week is complete", async ({ page }) => {
    const data = await useFixture(page, d => truncateToWeeks(d, 1));
    await page.goto("/index.html");

    await expect(page.locator("#standings-table th.lastwk")).toHaveText("Wk 1");
    await expect(page.locator("#standings-table tbody td.lastwk")).toHaveText(
      data.teams.map(t => t.ranking_points_by_week[0].toFixed(1))
    );
  });

  test("scrolls inside the table wrapper on a narrow viewport", async ({ page }) => {
    await useFixture(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/index.html");

    // The overflow the extra column creates belongs to the wrapper, not the page.
    const wrapper = page.locator("#table-section .table-wrap");
    const overflow = await wrapper.evaluate(el => ({
      scrolls: el.scrollWidth > el.clientWidth,
      style: getComputedStyle(el).overflowX,
    }));
    expect(overflow.scrolls).toBe(true);
    expect(overflow.style).toBe("auto");

    const pageOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pageOverflow).toBeLessThanOrEqual(0);
  });

  test("shows a dash, not a zero, when the week's points are absent", async ({ page }) => {
    const data = await useFixture(page, d => {
      const n = d.metadata.completed_weeks;
      d.teams[3].ranking_points_by_week[n - 1] = null;
      return d;
    });
    await page.goto("/index.html");

    const cells = page.locator("#standings-table tbody td.lastwk");
    await expect(cells.nth(3)).toHaveText("\u2014");
    // A genuine zero still reads as a number, so the dash means "absent".
    await expect(cells.nth(0)).toHaveText(
      data.teams[0].ranking_points_by_week.at(-1).toFixed(1));
  });
});
