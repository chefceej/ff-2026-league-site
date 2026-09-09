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

/** Every team block the week file holds, in the order the file holds them. */
const sidesOf = weekFile =>
  weekFile.matchups.flatMap(m => [m.home, m.away]).filter(Boolean);

const recordOf = r =>
  r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;

/** Serve the standings fixture and one week file per week up to `current`. */
async function openScoreboard(page, { current = 14, weeks = {}, query = "" } = {}) {
  const data = await useFixture(page, d => {
    d.metadata.week_files = Array.from({ length: current }, (_, i) => i + 1);
    d.metadata.current_week = current;
    return d;
  });
  const byWeek = {};
  for (let w = 1; w <= current; w++) byWeek[w] = loadWeekFixture("final");
  Object.assign(byWeek, weeks);
  await useWeekFixtures(page, byWeek);
  await page.goto(`/scoreboard.html${query}`);
  await page.locator(".matchup-card").first().waitFor();
  return data;
}

test.describe("Matchup cards", () => {
  test("shows one card per matchup, in the week file's order", async ({ page }) => {
    const week = loadWeekFixture("final");
    await openScoreboard(page, { weeks: { 14: week } });

    await expect(page.locator(".matchup-card")).toHaveCount(week.matchups.length);
    await expect(page.locator(".matchup-card .side-name"))
      .toHaveText(sidesOf(week).map(s => s.team_name));
  });

  test("names the manager and ESPN record on both sides", async ({ page }) => {
    const week = loadWeekFixture("final");
    await openScoreboard(page, { weeks: { 14: week } });

    await expect(page.locator(".matchup-card .side-mgr"))
      .toHaveText(sidesOf(week).map(s => s.owner));
    await expect(page.locator(".matchup-card .side-record"))
      .toHaveText(sidesOf(week).map(s => recordOf(s.record)));
  });

  test("shows the score on a final week and the projection while it is live",
       async ({ page }) => {
    // A real final week has the two equal, so the fixture is pulled apart here
    // to pin down which of the two the page actually reads once a week is over.
    const final = loadWeekFixture("final");
    for (const s of sidesOf(final)) s.projected_total = s.score + 40;
    await openScoreboard(page, { weeks: { 14: final } });
    await expect(page.locator(".matchup-card .card-status").first())
      .toHaveText("Final");
    await expect(page.locator(".matchup-card .side-total"))
      .toHaveText(sidesOf(final).map(s => s.score.toFixed(1)));

    const live = loadWeekFixture("in-progress");
    await page.goto("about:blank");
    await openScoreboard(page, { weeks: { 14: live } });
    await expect(page.locator(".matchup-card .card-status").first())
      .toHaveText("Projected");
    await expect(page.locator(".matchup-card .side-total"))
      .toHaveText(sidesOf(live).map(s => s.projected_total.toFixed(1)));
    // The live totals are a blend, not a repeat of the running score.
    expect(sidesOf(live).some(s => s.projected_total !== s.score)).toBe(true);
  });

  test("lists each side's three leaders with what they are worth now",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    await openScoreboard(page, { weeks: { 14: live } });

    const leaders = sidesOf(live).flatMap(s => s.leaders);
    await expect(page.locator(".matchup-card .leader-name"))
      .toHaveText(leaders.map(p => p.name));
    await expect(page.locator(".matchup-card .leader-pts"))
      .toHaveText(leaders.map(p => (p.played ? p.actual : p.projected).toFixed(1)));
    // A leader whose game is over is ranked on what he actually scored, so the
    // fixture has to contain one for the assertion above to mean anything.
    expect(leaders.some(p => p.played)).toBe(true);
  });

  test("marks the winner on a final week and nobody while it is live",
       async ({ page }) => {
    const final = loadWeekFixture("final");
    await openScoreboard(page, { weeks: { 14: final } });

    await expect(page.locator(".matchup-card .matchup-side.winner"))
      .toHaveCount(final.matchups.length);
    const winners = final.matchups.map(m =>
      m.home.score > m.away.score ? m.home.team_name : m.away.team_name);
    await expect(page.locator(".matchup-side.winner .side-name"))
      .toHaveText(winners);

    await page.goto("about:blank");
    await openScoreboard(page, { weeks: { 14: loadWeekFixture("in-progress") } });
    await expect(page.locator(".matchup-side.winner")).toHaveCount(0);
  });

  test("marks nobody in a final matchup that ended level", async ({ page }) => {
    const drawn = loadWeekFixture("final");
    drawn.matchups[0].away.score = drawn.matchups[0].home.score;
    await openScoreboard(page, { weeks: { 14: drawn } });

    // Five decided matchups still have a winner; the tied one has none.
    await expect(page.locator(".matchup-card").first()
      .locator(".matchup-side.winner")).toHaveCount(0);
    await expect(page.locator(".matchup-card .matchup-side.winner"))
      .toHaveCount(drawn.matchups.length - 1);
  });

  test("each card links to that matchup on the matchup page", async ({ page }) => {
    const week = loadWeekFixture("final");
    await openScoreboard(page, { weeks: { 14: week } });

    const hrefs = await page.locator(".matchup-card").evaluateAll(
      cards => cards.map(c => c.getAttribute("href")));
    expect(hrefs).toEqual(week.matchups.map(m =>
      `matchup.html?week=14&team=${encodeURIComponent(m.home.abbrev)}`));
  });
});

test.describe("Week navigation", () => {
  test("opens on the current week with the forward arrow disabled",
       async ({ page }) => {
    await openScoreboard(page, { weeks: { 14: loadWeekFixture("in-progress") } });

    await expect(page.locator("#week-nav-label")).toHaveText("Week 14");
    await expect(page.locator("#next-week-btn")).toBeDisabled();
    await expect(page.locator("#prev-week-btn")).toBeEnabled();
  });

  test("walks back to week 1 and stops there", async ({ page }) => {
    await openScoreboard(page, { weeks: { 14: loadWeekFixture("in-progress") } });

    for (let w = 13; w >= 1; w--) {
      await page.locator("#prev-week-btn").click();
      await expect(page.locator("#week-nav-label")).toHaveText(`Week ${w}`);
    }
    await expect(page.locator("#prev-week-btn")).toBeDisabled();
    await expect(page.locator("#next-week-btn")).toBeEnabled();
    // Week 1 is a past week, so it reads as a box score.
    await expect(page.locator(".matchup-card .card-status").first())
      .toHaveText("Final");
  });

  test("re-renders the cards for the week it lands on", async ({ page }) => {
    await openScoreboard(page, { weeks: { 14: loadWeekFixture("in-progress") } });
    await expect(page.locator(".matchup-card .card-status").first())
      .toHaveText("Projected");

    await page.locator("#prev-week-btn").click();
    await expect(page.locator("#week-nav-label")).toHaveText("Week 13");
    await expect(page.locator(".matchup-card .card-status").first())
      .toHaveText("Final");
    await page.locator("#next-week-btn").click();
    await expect(page.locator(".matchup-card .card-status").first())
      .toHaveText("Projected");
  });
});

test.describe("Highlighted team", () => {
  test("tints exactly the card the highlighted team plays in",
       async ({ page }) => {
    const week = loadWeekFixture("final");
    await openScoreboard(page, { weeks: { 14: week }, query: "?team=CJ" });

    await expect(page.locator(".matchup-card.highlight")).toHaveCount(1);
    await expect(page.locator(".matchup-card.highlight .side-name"))
      .toHaveText([week.matchups[0].home.team_name,
                   week.matchups[0].away.team_name]);
  });

  test("tints nothing when no team is highlighted", async ({ page }) => {
    await openScoreboard(page, { weeks: { 14: loadWeekFixture("final") } });
    await expect(page.locator(".matchup-card.highlight")).toHaveCount(0);
  });

  test("ignores a link naming a team this league does not have",
       async ({ page }) => {
    await openScoreboard(page, {
      weeks: { 14: loadWeekFixture("final") }, query: "?team=NOPE" });
    await expect(page.locator(".matchup-card.highlight")).toHaveCount(0);
  });
});

test.describe("Missing week", () => {
  test("shows the empty state and no cards when the week file is gone",
       async ({ page }) => {
    // Week 13's file never made it to the site; week 14's did.
    await openScoreboard(page, { weeks: { 13: null, 14: loadWeekFixture("final") } });
    await expect(page.locator(".matchup-card")).toHaveCount(6);

    await page.locator("#prev-week-btn").click();
    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator(".matchup-card")).toHaveCount(0);
    await expect(page.locator("#empty-message")).toContainText("Week 13");
    // The arrows stay live, so a missing week is not a dead end.
    await page.locator("#next-week-btn").click();
    await expect(page.locator("#empty-state")).toBeHidden();
    await expect(page.locator(".matchup-card")).toHaveCount(6);
  });
});
