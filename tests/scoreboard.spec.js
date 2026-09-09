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

test.describe("Week fixtures", () => {
  test("the in-progress week carries every case the pages have to handle",
       async () => {
    const live = loadWeekFixture("in-progress");
    expect(live.status).toBe("in-progress");
    const starters = sidesOf(live).flatMap(s => s.lineup);

    expect(starters.some(p => p.played)).toBe(true);
    expect(starters.some(p => !p.played && !p.on_bye)).toBe(true);
    expect(starters.some(p => p.on_bye && p.kickoff === null)).toBe(true);
    expect(starters.some(p => p.injury === "Q")).toBe(true);
    expect(starters.every(p => p.kickoff === null || /Z$/.test(p.kickoff)))
      .toBe(true);

    // One slot where the two sides swap places once the games are over: the
    // higher projection loses to the lower one's actual. The matchup page's
    // advantage mark has nothing to prove without it.
    const flips = live.matchups.flatMap(m =>
      m.home.lineup.map((home, i) => [home, m.away.lineup[i]]))
      .filter(([h, a]) => h && a && h.played && a.played)
      .filter(([h, a]) => (h.projected > a.projected) !== (h.actual > a.actual));
    expect(flips.length).toBeGreaterThan(0);
  });

  test("the final week has every starter played and no projection left",
       async () => {
    const done = loadWeekFixture("final");
    expect(done.status).toBe("final");
    for (const side of sidesOf(done)) {
      expect(side.lineup.every(p => p.played)).toBe(true);
      expect(side.to_play).toBe(0);
      expect(side.projected_total).toBeCloseTo(side.score, 2);
    }
  });
});

test.describe("Overlapping week changes", () => {
  /** Answer week `week` after `ms`, taking precedence over the fixture route. */
  async function delayWeek(page, week, ms, served) {
    await page.route(`**/data/week_${week}.json*`, async route => {
      await new Promise(r => setTimeout(r, ms));
      if (!served) return route.fulfill({ status: 404, body: "" });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(served),
      });
    });
  }

  test("a slow week that lands late does not paint under a later week's label",
       async ({ page }) => {
    await openScoreboard(page, { weeks: { 14: loadWeekFixture("in-progress") } });
    // Week 13 answers slowly with an in-progress week; week 12 answers at once
    // with a final one, so the two renders are told apart by the card status.
    await delayWeek(page, 13, 600, loadWeekFixture("in-progress"));

    await page.locator("#prev-week-btn").click();   // -> 13, still in flight
    await page.locator("#prev-week-btn").click();   // -> 12, answers first
    await expect(page.locator("#week-nav-label")).toHaveText("Week 12");
    await expect(page.locator(".matchup-card .card-status").first())
      .toHaveText("Final");

    // Give week 13's answer time to arrive and try to take the DOM.
    await page.waitForTimeout(900);
    await expect(page.locator("#week-nav-label")).toHaveText("Week 12");
    await expect(page.locator(".matchup-card .card-status").first())
      .toHaveText("Final");
  });

  test("a slow week that turns out to be missing does not wipe the week on screen",
       async ({ page }) => {
    await openScoreboard(page, { weeks: { 14: loadWeekFixture("in-progress") } });
    await delayWeek(page, 13, 600, null);           // 404, but slowly

    await page.locator("#prev-week-btn").click();   // -> 13, will 404 late
    await page.locator("#next-week-btn").click();   // -> back to 14, answers now
    await expect(page.locator("#week-nav-label")).toHaveText("Week 14");

    await page.waitForTimeout(900);
    await expect(page.locator("#empty-state")).toBeHidden();
    await expect(page.locator(".matchup-card")).toHaveCount(6);
  });
});

test.describe("Projected standings block", () => {
  /** The block's rows as the DOM shows them, in the order they are rendered. */
  const blockRows = page => page.locator("#projected-table tbody tr");

  // Order, values and movement are the same contract whether the week is still
  // being played or already settled, so both frozen weeks are held to it.
  for (const kind of ["in-progress", "final"]) {
    test(`lists every team in the ${kind} week file's order`, async ({ page }) => {
      const week = loadWeekFixture(kind);
      await openScoreboard(page, { weeks: { 14: week } });

      await expect(blockRows(page)).toHaveCount(week.projected_standings.length);
      await expect(page.locator("#projected-table td.team"))
        .toHaveText(week.projected_standings.map(r => r.team_name));
      // The file orders the teams by projected total; the page must not re-sort.
      const totals = week.projected_standings.map(r => r.projected_total);
      expect([...totals].sort((a, b) => b - a)).toEqual(totals);
    });

    test(`shows rank, total, ranking points and normalized on a ${kind} week`,
         async ({ page }) => {
      const week = loadWeekFixture(kind);
      await openScoreboard(page, { weeks: { 14: week } });
      const rows = week.projected_standings;

      await expect(page.locator("#projected-table .rk-num"))
        .toHaveText(rows.map(r => String(r.projected_rank)));
      await expect(page.locator("#projected-table td.proj"))
        .toHaveText(rows.map(r => r.projected_total.toFixed(1)));
      await expect(page.locator("#projected-table td.rp"))
        .toHaveText(rows.map(r => r.projected_ranking_points.toFixed(1)));
      await expect(page.locator("#projected-table td.norm"))
        .toHaveText(rows.map(r => (r.projected_normalized > 0 ? "+" : "") +
                                  r.projected_normalized));
    });

    test(`marks a normalized total above the cutoff apart from one below on a ${kind} week`,
         async ({ page }) => {
      const week = loadWeekFixture(kind);
      await openScoreboard(page, { weeks: { 14: week } });
      const rows = week.projected_standings;

      await expect(page.locator("#projected-table td.norm.pos"))
        .toHaveCount(rows.filter(r => r.projected_normalized >= 0).length);
      await expect(page.locator("#projected-table td.norm.neg"))
        .toHaveCount(rows.filter(r => r.projected_normalized < 0).length);
    });

    test(`draws the Standings table's own movement indicator on a ${kind} week`,
         async ({ page }) => {
      const week = loadWeekFixture(kind);
      await openScoreboard(page, { weeks: { 14: week } });
      const rows = week.projected_standings;

      const move = r => r.current_rank - r.projected_rank;
      await expect(page.locator("#projected-table .mv-glyph")).toHaveText(
        rows.map(r => move(r) > 0 ? `▲${move(r)}`
                    : move(r) < 0 ? `▼${-move(r)}` : "–"));
      await expect(page.locator("#projected-table .mv-label")).toHaveText(
        rows.map(r => move(r) > 0 ? `up ${move(r)}`
                    : move(r) < 0 ? `down ${-move(r)}` : "no change"));
      await expect(page.locator("#projected-table .mv.up"))
        .toHaveCount(rows.filter(r => move(r) > 0).length);
      await expect(page.locator("#projected-table .mv.down"))
        .toHaveCount(rows.filter(r => move(r) < 0).length);
      // The fixture has to contain a mover each way, and a team that held its
      // place, for that to mean anything.
      expect(rows.some(r => move(r) > 0)).toBe(true);
      expect(rows.some(r => move(r) < 0)).toBe(true);
      expect(rows.some(r => move(r) === 0)).toBe(true);
    });
  }

  test("says the numbers are projections until the week is final",
       async ({ page }) => {
    await openScoreboard(page, { weeks: { 14: loadWeekFixture("in-progress") } });
    await expect(page.locator("#projected-heading"))
      .toHaveText("Projected standings after Week 14");
  });

  test("says the numbers are the standings once the week is final",
       async ({ page }) => {
    await openScoreboard(page, { weeks: { 14: loadWeekFixture("final") } });
    await expect(page.locator("#projected-heading"))
      .toHaveText("Standings after Week 14");
  });

  test("reads an upcoming week as a projection too", async ({ page }) => {
    const soon = loadWeekFixture("in-progress");
    soon.status = "upcoming";
    await openScoreboard(page, { weeks: { 14: soon } });
    await expect(page.locator("#projected-heading"))
      .toHaveText("Projected standings after Week 14");
  });

  test("names the week it lands on when the arrows move", async ({ page }) => {
    await openScoreboard(page, { weeks: { 14: loadWeekFixture("in-progress") } });
    await expect(page.locator("#projected-heading"))
      .toHaveText("Projected standings after Week 14");

    await page.locator("#prev-week-btn").click();
    await expect(page.locator("#projected-heading"))
      .toHaveText("Standings after Week 13");
  });

  test("is left off a week that carries no block", async ({ page }) => {
    // A playoff week writes no projected standings: the bracket hands out no
    // ranking points, so there is nothing honest to show.
    const playoffs = loadWeekFixture("final");
    playoffs.is_playoff = true;
    delete playoffs.projected_standings;
    await openScoreboard(page, { weeks: { 14: playoffs } });

    await expect(page.locator(".matchup-card")).toHaveCount(6);
    await expect(page.locator("#projected-standings")).toBeHidden();
  });

  test("goes away when the week on screen has no file", async ({ page }) => {
    await openScoreboard(page, { weeks: { 13: null, 14: loadWeekFixture("final") } });
    await expect(page.locator("#projected-standings")).toBeVisible();

    await page.locator("#prev-week-btn").click();
    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator("#projected-standings")).toBeHidden();
  });

  test("draws no arrows on a week nobody has entered with anything",
       async ({ page }) => {
    // Week 1: every team starts level, so there is no order to have moved from
    // and the page must not invent one. The transform settles this, but the
    // arrows are what a reader sees, so the rule is pinned where they are drawn.
    const first = loadWeekFixture("in-progress");
    for (const [i, row] of first.projected_standings.entries()) {
      row.current_rank = i + 1;
      row.projected_rank = i + 1;
    }
    await openScoreboard(page, { current: 1, weeks: { 1: first } });

    await expect(page.locator("#projected-table .mv.flat"))
      .toHaveCount(first.projected_standings.length);
    await expect(page.locator("#projected-table .mv.up")).toHaveCount(0);
    await expect(page.locator("#projected-table .mv.down")).toHaveCount(0);
  });

  test("sits below the matchup cards", async ({ page }) => {
    await openScoreboard(page, { weeks: { 14: loadWeekFixture("in-progress") } });

    const order = await page.evaluate(() => {
      const cards = document.getElementById("matchup-cards");
      const block = document.getElementById("projected-standings");
      return cards.compareDocumentPosition(block) &
             Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(order).toBeGreaterThan(0);
  });
});

test.describe("Playoff weeks", () => {
  /** The bracket week, opened as the current week with week 14 behind it. */
  const openPlayoffs = page =>
    openScoreboard(page, { current: 15,
                           weeks: { 15: loadWeekFixture("playoff") } });

  test("labels the week as the playoffs", async ({ page }) => {
    await openPlayoffs(page);

    await expect(page.locator("#week-nav-label")).toHaveText("Week 15");
    await expect(page.locator("#week-playoff-label")).toBeVisible();
    await expect(page.locator("#week-playoff-label")).toHaveText("Playoffs");
  });

  test("drops the label again on a regular-season week", async ({ page }) => {
    // The flag arrives with the week file, so the label has to follow the
    // arrows rather than stay where the first render put it.
    await openPlayoffs(page);
    await expect(page.locator("#week-playoff-label")).toBeVisible();

    await page.locator("#prev-week-btn").click();
    await expect(page.locator("#week-nav-label")).toHaveText("Week 14");
    await expect(page.locator("#week-playoff-label")).toBeHidden();

    await page.locator("#next-week-btn").click();
    await expect(page.locator("#week-playoff-label")).toBeVisible();
  });

  test("shows no label on a week that has no file", async ({ page }) => {
    await openScoreboard(page, { current: 15,
                                 weeks: { 14: null,
                                          15: loadWeekFixture("playoff") } });
    await expect(page.locator("#week-playoff-label")).toBeVisible();

    await page.locator("#prev-week-btn").click();
    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator("#week-playoff-label")).toBeHidden();
  });

  test("renders a bye as a single-team card marked bye", async ({ page }) => {
    const week = loadWeekFixture("playoff");
    await openPlayoffs(page);
    const byes = week.matchups.filter(m => !m.away);

    await expect(page.locator(".matchup-card")).toHaveCount(week.matchups.length);
    await expect(page.locator(".matchup-card.bye")).toHaveCount(byes.length);
    // One team, named, and the word bye where the opponent would be.
    await expect(page.locator(".matchup-card.bye").first()
                     .locator(".side-name"))
      .toHaveText([byes[0].home.team_name]);
    await expect(page.locator(".matchup-card.bye").first().locator(".bye-side"))
      .toHaveText("Bye");
  });

  test("marks no winner and no bye on a played matchup", async ({ page }) => {
    const week = loadWeekFixture("playoff");
    await openPlayoffs(page);
    const played = week.matchups.filter(m => m.away);

    await expect(page.locator(".matchup-card:not(.bye)"))
      .toHaveCount(played.length);
    await expect(page.locator(".matchup-card:not(.bye) .bye-side"))
      .toHaveCount(0);
  });

  test("leaves the projected standings block off entirely", async ({ page }) => {
    await openPlayoffs(page);

    await expect(page.locator("#projected-standings")).toBeHidden();
    // Still a preview: the cards carry the week's projected totals.
    await expect(page.locator(".matchup-card .card-status").first())
      .toHaveText("Projected");
  });
});
