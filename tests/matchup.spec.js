const { test, expect } = require("@playwright/test");
const { useFixture, useWeekFixtures, loadWeekFixture } = require("./fixture");

// A one-pixel PNG: every headshot and logo the page asks for answers with this,
// so a test never waits on ESPN's CDN and an image only fails when a test says
// it does.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGA" +
  "hKmMIQAAAABJRU5ErkJggg==", "base64");
const REMOTE_IMAGE = /espncdn\.com|fixtures\.invalid/;

async function serveImages(page) {
  await page.route(REMOTE_IMAGE, route =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
}
async function breakImages(page) {
  await page.route(REMOTE_IMAGE, route => route.abort());
}

/**
 * Serve the standings fixture and one week file per week up to `current`, then
 * open the matchup page. `weeks` overrides individual weeks (null = missing),
 * `remembered` seeds the highlight this device would already carry.
 */
async function openMatchup(page, {
  current = 14, currentWeek = null, weeks = {}, query = "",
  remembered = null, images = serveImages,
} = {}) {
  const data = await useFixture(page, d => {
    d.metadata.week_files = Array.from({ length: current }, (_, i) => i + 1);
    d.metadata.current_week = currentWeek == null ? current : currentWeek;
    return d;
  });
  const byWeek = {};
  for (let w = 1; w <= current; w++) byWeek[w] = loadWeekFixture("final");
  Object.assign(byWeek, weeks);
  await useWeekFixtures(page, byWeek);
  await images(page);
  if (remembered) {
    await page.addInitScript(abbrev => {
      localStorage.setItem("ff-highlight-team", abbrev);
    }, remembered);
  }
  await page.goto(`/matchup.html${query}`);
  return data;
}

/**
 * The two lineups paired the way the page has to pair them. The fixtures give
 * both sides the same slots in the same order, so for them this is index
 * pairing; the tests that pull a slot out of one side spell out the answer
 * themselves rather than leaning on this.
 */
const pairs = (matchup, key = "lineup") => {
  const home = matchup.home ? matchup.home[key] : [];
  const away = matchup.away ? matchup.away[key] : [];
  return Array.from({ length: Math.max(home.length, away.length) },
                    (_, i) => [home[i] || null, away[i] || null]);
};

/** Every row's slot label, home player and away player, in page order. */
const rowShapes = async page => {
  await page.locator("#lineup-rows .lineup-row").first().waitFor();
  return page.locator("#lineup-rows .lineup-row").evaluateAll(rows =>
    rows.map(r => {
      const text = (side, sel) => {
        const node = r.querySelector(`.slot-side.${side} ${sel}`);
        return node ? node.textContent : null;
      };
      return {
        label: r.querySelector(".slot-label").textContent,
        home: text("home", ".player-name"),
        away: text("away", ".player-name"),
        advantage: r.querySelector(".slot-side.advantage.home") ? "home"
          : r.querySelector(".slot-side.advantage.away") ? "away" : "",
      };
    }));
};

const oneDecimal = n => n.toFixed(1);

test.describe("Which matchup the page opens", () => {
  test("opens the week and team the link names, not the current week",
       async ({ page }) => {
    // Week 14 is current and still running; the link asks for week 13, which is
    // over. Naming a week the page would have opened anyway proves nothing.
    const live = loadWeekFixture("in-progress");
    const done = loadWeekFixture("final");
    done.week = 13;          // a file served as week 13 says week 13
    await openMatchup(page, {
      weeks: { 13: done, 14: live }, query: "?week=13&team=BW" });

    await expect(page.locator("#subtitle")).toContainText("Week 13");
    await expect(page.locator("#subtitle")).toContainText("Final");
    await expect(page.locator(".team-head-name")).toHaveText(
      [done.matchups[2].home.team_name, done.matchups[2].away.team_name]);
  });

  test("with no parameters opens the current week and the remembered team",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    await openMatchup(page, { weeks: { 14: live }, remembered: "MBJG" });

    await expect(page.locator("#subtitle")).toContainText("Week 14");
    await expect(page.locator(".team-head-name")).toHaveText(
      [live.matchups[3].home.team_name, live.matchups[3].away.team_name]);
  });

  test("a link's team beats the one this device remembers", async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    await openMatchup(page, {
      weeks: { 14: live }, remembered: "MBJG", query: "?team=BW" });

    await expect(page.locator(".team-head-name")).toHaveText(
      [live.matchups[2].home.team_name, live.matchups[2].away.team_name]);
  });

  test("falls back to the week's first matchup when no team is highlighted",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    await openMatchup(page, { weeks: { 14: live } });

    await expect(page.locator(".team-head-name")).toHaveText(
      [live.matchups[0].home.team_name, live.matchups[0].away.team_name]);
  });

  test("falls back to the first matchup when the link names nobody we know",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    await openMatchup(page, { weeks: { 14: live }, query: "?team=NOPE" });

    await expect(page.locator(".team-head-name")).toHaveText(
      [live.matchups[0].home.team_name, live.matchups[0].away.team_name]);
  });

  test("falls back to the first matchup when the team does not play that week",
       async ({ page }) => {
    // A league team the week file has no matchup for: a stale link, or a
    // playoff week the team is not in.
    const live = loadWeekFixture("in-progress");
    live.matchups.splice(3, 1);
    await openMatchup(page, { weeks: { 14: live }, query: "?team=MBJG" });

    await expect(page.locator(".team-head-name")).toHaveText(
      [live.matchups[0].home.team_name, live.matchups[0].away.team_name]);
  });

  test("opens the current week when the link names a week nobody published",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    await openMatchup(page, { weeks: { 14: live }, query: "?week=99&team=CJ" });

    await expect(page.locator("#subtitle")).toContainText("Week 14");
    await expect(page.locator("#lineup-rows .lineup-row")).toHaveCount(9);
  });

  test("opens the newest published week when the current one was never written",
       async ({ page }) => {
    // The metadata names a current week no run ever wrote a file for. The
    // Scoreboard opens on the most recent week it has; so does this page.
    const live = loadWeekFixture("in-progress");
    await openMatchup(page, {
      weeks: { 14: live }, currentWeek: 99, query: "?team=CJ" });

    await expect(page.locator("#subtitle")).toContainText("Week 14");
    await expect(page.locator("#lineup-rows .lineup-row")).toHaveCount(9);
  });

  test("shows the empty state when the week file is gone", async ({ page }) => {
    await openMatchup(page, { weeks: { 13: null }, query: "?week=13&team=CJ" });

    await expect(page.locator("#empty-state")).toBeVisible();
    await expect(page.locator("#empty-message")).toContainText("Week 13");
    await expect(page.locator("#lineup-rows .lineup-row")).toHaveCount(0);
  });
});

test.describe("The header", () => {
  test("names both teams with manager, record and counts", async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const sides = [live.matchups[0].home, live.matchups[0].away];
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    await expect(page.locator(".team-head-name"))
      .toHaveText(sides.map(s => s.team_name));
    await expect(page.locator(".team-head-mgr"))
      .toHaveText(sides.map(s => s.owner));
    await expect(page.locator(".team-head-record")).toHaveText(
      sides.map(s => `${s.record.wins}-${s.record.losses}`));
    await expect(page.locator(".counts-played"))
      .toHaveText(sides.map(s => String(s.played)));
    await expect(page.locator(".counts-to-play"))
      .toHaveText(sides.map(s => String(s.to_play)));
    await expect(page.locator(".team-head-logo")).toHaveCount(2);
    expect(await page.locator(".team-head-logo").first()
      .getAttribute("src")).toBe(sides[0].logo_url);
  });

  test("shows the projected total while the week runs and the score once final",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const running = [live.matchups[0].home, live.matchups[0].away];
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });
    await expect(page.locator(".team-head-total"))
      .toHaveText(running.map(s => oneDecimal(s.projected_total)));
    await expect(page.locator(".total-label").first()).toHaveText("Projected");

    // A real final week has the two equal, so the fixture is pulled apart to
    // pin down which of them a settled week actually reads.
    const done = loadWeekFixture("final");
    for (const m of done.matchups) {
      for (const s of [m.home, m.away]) s.projected_total = s.score + 40;
    }
    await page.goto("about:blank");
    await openMatchup(page, { weeks: { 14: done }, query: "?week=14&team=CJ" });
    await expect(page.locator(".team-head-total")).toHaveText(
      [done.matchups[0].home, done.matchups[0].away].map(s => oneDecimal(s.score)));
    await expect(page.locator(".total-label").first()).toHaveText("Score");
  });
});

test.describe("The lineup rows", () => {
  test("pairs the two lineups by index in ESPN's slot order", async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const rows = pairs(live.matchups[0]);
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    await expect(page.locator("#lineup-rows .lineup-row"))
      .toHaveCount(rows.length);
    await expect(page.locator("#lineup-rows .slot-label"))
      .toHaveText(rows.map(([h, a]) => (h || a).slot));
    await expect(page.locator("#lineup-rows .slot-side.home .player-name"))
      .toHaveText(rows.map(([h]) => h.name));
    await expect(page.locator("#lineup-rows .slot-side.away .player-name"))
      .toHaveText(rows.map(([, a]) => a.name));
  });

  test("shows NFL team, position and injury tag", async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const home = live.matchups[0].home.lineup;
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    const rows = page.locator("#lineup-rows .slot-side.home");
    await expect(rows.locator(".player-team"))
      .toHaveText(home.map(p => p.pro_team));
    await expect(rows.locator(".player-pos"))
      .toHaveText(home.map(p => p.position));
    // One home starter is questionable; only he carries a tag.
    const tagged = home.filter(p => p.injury);
    expect(tagged.length).toBeGreaterThan(0);
    await expect(rows.locator(".injury-tag"))
      .toHaveText(tagged.map(p => p.injury));
  });

  test("marks a bye with no opponent and no kickoff", async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const away = live.matchups[0].away.lineup;
    const byeIndex = away.findIndex(p => p.on_bye);
    expect(byeIndex).toBeGreaterThan(-1);
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    const cell = page.locator("#lineup-rows .lineup-row").nth(byeIndex)
      .locator(".slot-side.away");
    await expect(cell.locator(".player-bye")).toHaveText("BYE");
    await expect(cell.locator(".player-opp")).toHaveCount(0);
    await expect(cell.locator(".player-kick")).toHaveCount(0);
  });

  test("shows the projection always and the actual only once played",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const home = live.matchups[0].home.lineup;
    expect(home[0].played).toBe(true);
    expect(home[1].played).toBe(false);
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    const rows = page.locator("#lineup-rows .slot-side.home");
    await expect(rows.locator(".pts-proj"))
      .toHaveText(home.map(p => oneDecimal(p.projected)));
    await expect(rows.locator(".pts-actual"))
      .toHaveText(home.filter(p => p.played).map(p => oneDecimal(p.actual)));
    await expect(page.locator("#lineup-rows .lineup-row").nth(1)
      .locator(".slot-side.home .pts-actual")).toHaveCount(0);
  });
});

test.describe("Kickoffs in the viewer's own time zone", () => {
  // The week file writes kickoffs as ISO 8601 UTC; the page is the only place
  // that turns them into a wall clock, so the same instant has to read
  // differently on two coasts.
  const KICK = "2025-12-14T18:00:00Z";   // 1:00 pm in New York, 10:00 am in LA

  test.describe("on the east coast", () => {
    test.use({ timezoneId: "America/New_York", locale: "en-US" });
    test("reads as the eastern wall clock", async ({ page }) => {
      const live = loadWeekFixture("in-progress");
      expect(live.matchups[0].home.lineup[1].kickoff).toBe(KICK);
      await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

      await expect(page.locator("#lineup-rows .lineup-row").nth(1)
        .locator(".slot-side.home .player-kick")).toHaveText("Sun 1:00 PM");
      await expect(page.locator("#lineup-rows .lineup-row").nth(1)
        .locator(".slot-side.home .player-opp")).toHaveText("@LAR");
    });
  });

  test.describe("on the west coast", () => {
    test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });
    test("reads as the pacific wall clock", async ({ page }) => {
      const live = loadWeekFixture("in-progress");
      await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

      await expect(page.locator("#lineup-rows .lineup-row").nth(1)
        .locator(".slot-side.home .player-kick")).toHaveText("Sun 10:00 AM");
    });
  });
});

test.describe("The advantage mark", () => {
  /** Which side of each row is marked: "home", "away", or "" for neither. */
  const marks = async page => {
    // evaluateAll reads the DOM as it is, with none of an expect's retrying, so
    // the rows have to be on the page before it looks.
    await page.locator("#lineup-rows .lineup-row").first().waitFor();
    return page.locator("#lineup-rows .lineup-row").evaluateAll(
    rows => rows.map(r => {
      const side = r.querySelector(".slot-side.advantage");
      return side ? (side.classList.contains("home") ? "home" : "away") : "";
    }));
  };

  test("goes to the higher projection while the games are still to come",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const rows = pairs(live.matchups[2]);   // nobody in this matchup has played
    expect(rows.every(([h, a]) => !h.played && !a.played)).toBe(true);
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=BW" });

    expect(await marks(page)).toEqual(
      rows.map(([h, a]) => (h.projected > a.projected ? "home" : "away")));
  });

  test("switches to the actual once both sides of a row have played",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const [home, away] = pairs(live.matchups[0])[0];
    // The fixture's flipped row: the higher projection loses on the day.
    expect(home.played && away.played).toBe(true);
    expect(home.projected < away.projected).toBe(true);
    expect(home.actual > away.actual).toBe(true);
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    expect((await marks(page))[0]).toBe("home");
    await expect(page.locator("#lineup-rows .lineup-row").first()
      .locator(".slot-side.home .adv-mark")).toHaveCount(1);
  });

  test("stays on the projection while only one side of a row has played",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const [home, away] = pairs(live.matchups[0])[0];
    away.played = false;                    // his game has not kicked off yet
    away.actual = 0;
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    // Home outscored him on the day but is still the lower projection.
    expect(home.projected < away.projected).toBe(true);
    expect((await marks(page))[0]).toBe("away");
  });

  test("marks nobody on a tie, a bye, or an empty slot", async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const rows = pairs(live.matchups[0]);
    rows[3][1].projected = rows[3][0].projected;      // level on projection
    const byeIndex = rows.findIndex(([, a]) => a.on_bye);
    live.matchups[0].away.lineup.pop();               // last row loses its away
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    const marked = await marks(page);
    expect(marked[3]).toBe("");
    expect(marked[byeIndex]).toBe("");
    expect(marked[marked.length - 1]).toBe("");
    await expect(page.locator("#lineup-rows .lineup-row").last()
      .locator(".slot-side.away.empty")).toHaveCount(1);
    await expect(page.locator("#lineup-rows .lineup-row").last()
      .locator(".slot-side.away .player")).toHaveCount(0);
    // The rows that are none of those three still carry their mark.
    expect(marked.filter(Boolean).length).toBeGreaterThan(3);
  });

  test("marks nobody at all in a playoff matchup with a bye", async ({ page }) => {
    const bye = loadWeekFixture("in-progress");
    bye.is_playoff = true;
    bye.matchups = [{ home: bye.matchups[0].home, away: null }];
    await openMatchup(page, { weeks: { 14: bye }, query: "?week=14&team=CJ" });

    await expect(page.locator(".team-head")).toHaveCount(1);
    await expect(page.locator("#lineup-rows .slot-side.away.empty"))
      .toHaveCount(9);
    await expect(page.locator(".slot-side.advantage")).toHaveCount(0);
  });
});

test.describe("Lineups that are not the same shape", () => {
  // Index pairing survives the frozen fixtures only because both sides were
  // hand-written with identical slots. A manager who drops a tight end and
  // never refills the slot shifts every row below it, which is how a D/ST ends
  // up labelled as a kicker's row with a confident advantage mark on it.
  const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "RB/WR/TE", "D/ST", "K"];

  test("keeps each row on one slot when a side is short in the middle",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const m = live.matchups[0];
    const [dropped] = m.away.lineup.splice(5, 1);       // the away tight end
    expect(dropped.slot).toBe("TE");
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    const shapes = await rowShapes(page);
    expect(shapes.map(r => r.label)).toEqual(SLOTS);
    expect(shapes.map(r => r.home)).toEqual(m.home.lineup.map(p => p.name));
    // The tight-end row has nobody opposite it; everything below stays paired
    // with its own slot rather than sliding up one.
    expect(shapes[5].away).toBe(null);
    expect(shapes.map(r => r.away)).toEqual([
      ...m.away.lineup.slice(0, 5).map(p => p.name),
      null,
      ...m.away.lineup.slice(5).map(p => p.name),
    ]);
    // And no mark is handed out across positions, or on the empty row.
    expect(shapes.map(r => r.advantage)).toEqual(
      ["home", "", "away", "home", "away", "", "home", "away", "away"]);
  });

  test("gives a slot only the other side filled a row of its own",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const m = live.matchups[0];
    m.home.lineup.splice(5, 1);                         // the home tight end
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    const shapes = await rowShapes(page);
    expect(shapes.map(r => r.label)).toEqual(SLOTS);
    expect(shapes[5].home).toBe(null);
    expect(shapes[5].away).toBe(m.away.lineup[5].name);
    expect(shapes[5].advantage).toBe("");
    await expect(page.locator("#lineup-rows .slot-side.home.empty"))
      .toHaveCount(1);
  });

  test("never pairs a benched player against an injured-reserve one",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const m = live.matchups[0];
    m.away.bench[2].slot = "IR";
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });
    await page.locator("#bench-toggle").click();

    await expect(page.locator("#bench-rows .slot-label"))
      .toHaveText(["BE", "BE", "BE", "IR"]);
    // The third bench row keeps the home player and loses its opposite; the
    // IR gets a row of its own.
    await expect(page.locator("#bench-rows .lineup-row").nth(2)
      .locator(".slot-side.away.empty")).toHaveCount(1);
    await expect(page.locator("#bench-rows .lineup-row").nth(3)
      .locator(".slot-side.home.empty")).toHaveCount(1);
    await expect(page.locator("#bench-rows .lineup-row").nth(3)
      .locator(".slot-side.away .player-name"))
      .toHaveText(m.away.bench[2].name);
  });
});

test.describe("The bench", () => {
  test("stays hidden until the toggle asks for it", async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const rows = pairs(live.matchups[0], "bench");
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    await expect(page.locator("#bench-toggle")).toHaveText("Show bench");
    await expect(page.locator("#bench-rows")).toBeHidden();

    await page.locator("#bench-toggle").click();
    await expect(page.locator("#bench-rows")).toBeVisible();
    await expect(page.locator("#bench-toggle")).toHaveText("Hide bench");
    await expect(page.locator("#bench-rows .lineup-row")).toHaveCount(rows.length);
    await expect(page.locator("#bench-rows .slot-side.home .player-name"))
      .toHaveText(rows.map(([h]) => h.name));
    // The bench is not a matchup, so nothing on it is anyone's advantage.
    await expect(page.locator("#bench-rows .slot-side.advantage")).toHaveCount(0);

    await page.locator("#bench-toggle").click();
    await expect(page.locator("#bench-rows")).toBeHidden();
  });
});

test.describe("Headshots", () => {
  test("keys the headshot to the player and the team logo to a D/ST",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    const home = live.matchups[0].home.lineup;
    const dstIndex = home.findIndex(p => p.position === "D/ST");
    expect(dstIndex).toBeGreaterThan(-1);
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    const shots = page.locator("#lineup-rows .slot-side.home .player-shot");
    expect(await shots.first().getAttribute("src")).toBe(
      `https://a.espncdn.com/i/headshots/nfl/players/full/${home[0].player_id}.png`);
    expect(await shots.nth(dstIndex).getAttribute("src")).toBe(
      `https://a.espncdn.com/i/teamlogos/nfl/500/${home[dstIndex].pro_team.toLowerCase()}.png`);
  });

  test("gives a Team QB the NFL team's logo, not a face", async ({ page }) => {
    // A Team QB is a whole team's quarterbacks. build_week_file writes its
    // position as plain QB, so the slot is the only thing that names it -- and
    // neither frozen week has one, hence the slot swap here.
    const live = loadWeekFixture("in-progress");
    const starter = live.matchups[0].home.lineup[0];
    // Both sides: a Team QB league runs the slot league-wide, and the rows
    // pair on it.
    starter.slot = "TQB";
    live.matchups[0].away.lineup[0].slot = "TQB";
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });

    const shot = page.locator("#lineup-rows .lineup-row").first()
      .locator(".slot-side.home .player-shot");
    expect(await shot.getAttribute("src")).toBe(
      `https://a.espncdn.com/i/teamlogos/nfl/500/${starter.pro_team.toLowerCase()}.png`);
    // The slot column still reads the way ESPN names it.
    await expect(page.locator("#lineup-rows .slot-label").first())
      .toHaveText("TQB");
  });

  test("swaps in a silhouette when the headshot will not load",
       async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    await openMatchup(page, {
      weeks: { 14: live }, query: "?week=14&team=CJ", images: breakImages });

    const cell = page.locator("#lineup-rows .lineup-row").first()
      .locator(".slot-side.home");
    await expect(cell.locator("svg.player-silhouette")).toHaveCount(1);
    await expect(cell.locator("img.player-shot")).toHaveCount(0);
    // The row it stands in is otherwise untouched.
    await expect(cell.locator(".player-name"))
      .toHaveText(live.matchups[0].home.lineup[0].name);
  });
});

test.describe("On a phone", () => {
  test.use({ viewport: { width: 375, height: 720 } });

  test("keeps the rows on screen without sideways scrolling", async ({ page }) => {
    const live = loadWeekFixture("in-progress");
    await openMatchup(page, { weeks: { 14: live }, query: "?week=14&team=CJ" });
    await page.locator("#bench-toggle").click();

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Every row still shows both names and both numbers.
    const row = page.locator("#lineup-rows .lineup-row").first();
    await expect(row.locator(".player-name")).toHaveCount(2);
    await expect(row.locator(".pts-proj")).toHaveCount(2);
    await expect(row.locator(".slot-side.home .player-name")).toBeVisible();
  });
});
