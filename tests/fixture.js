// Shared test seam: frozen league JSON in, rendered DOM out.
// Tests never hit docs/data/league_data.json, so a new week of committed
// scores can never change what the assertions see.
const fs = require("fs");
const path = require("path");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "league_data.json");

/** A fresh parsed copy of the frozen fixture, safe for a test to mutate. */
function loadFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

/**
 * Answer every request for the league data with the fixture.
 * `mutate` receives the parsed copy and returns the data to serve, which is how
 * edge cases (Week 1, ties, absent cells) are produced without touching
 * production code.
 * Returns the data the page will actually receive.
 */
async function useFixture(page, mutate) {
  const data = loadFixture();
  const served = mutate ? mutate(data) : data;
  await page.route("**/data/league_data.json*", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(served),
    })
  );
  return served;
}

/**
 * The frozen week files: one week before it is final, one after, and a playoff
 * week -- which carries two byes and no projected standings block.
 */
const WEEK_FIXTURES = {
  "in-progress": "week_in_progress.json",
  final: "week_final.json",
  playoff: "week_playoff.json",
};

/** A fresh parsed copy of one week fixture, safe for a test to mutate. */
function loadWeekFixture(kind) {
  const name = WEEK_FIXTURES[kind];
  if (!name) throw new Error(`no week fixture named ${kind}`);
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
}

/**
 * Answer every request for a week file from `byWeek`, keyed by week number.
 * A week the map does not name answers 404, which is how the page's missing-week
 * empty state is produced without deleting anything.
 */
async function useWeekFixtures(page, byWeek) {
  await page.route("**/data/week_*.json*", route => {
    const week = /week_(\d+)\.json/.exec(route.request().url())?.[1];
    const served = byWeek[Number(week)];
    if (!served) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(served),
    });
  });
}

const last = arr => (arr.length ? arr[arr.length - 1] : 0);

/** Truncate every per-week array so only `weeks` weeks are complete. */
function truncateToWeeks(data, weeks) {
  const meta = data.metadata;
  meta.completed_weeks = weeks;
  meta.current_matchup_week = weeks;
  for (const t of data.teams) {
    for (const key of ["scores_by_week", "ranking_points_by_week",
                       "cumulative_points_by_week", "normalized_by_week"]) {
      t[key] = t[key].slice(0, weeks);
    }
  }
  // Mirror the fetch script: teams are delivered sorted by final cumulative
  // points, descending and stable, with rank assigned from that order.
  data.teams = data.teams
    .map((t, i) => ({ t, i }))
    .sort((a, b) => last(b.t.cumulative_points_by_week) - last(a.t.cumulative_points_by_week)
                    || a.i - b.i)
    .map(({ t }, i) => {
      t.rank = i + 1;
      t.total_ranking_points = last(t.cumulative_points_by_week);
      return t;
    });
  if (Array.isArray(data.top_players_by_week)) {
    data.top_players_by_week = data.top_players_by_week.slice(0, weeks);
  }
  if (Array.isArray(data.position_scores_by_week)) {
    data.position_scores_by_week = data.position_scores_by_week.slice(0, weeks);
  }
  return data;
}

module.exports = { useFixture, useWeekFixtures, loadFixture,
                   loadWeekFixture, truncateToWeeks };
