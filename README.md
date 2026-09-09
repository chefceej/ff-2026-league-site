# Fantasy Football League Standings

A static site showing cumulative **ranking-point** standings for our ESPN
fantasy football league, normalized so the playoff-cutoff team sits at 0.

Each week, teams are ranked by score (best gets *N* points, worst gets 1, ties
averaged); those points accumulate all season, then the total is shifted so
**6th place = 0** — positive means you're in the playoff picture.

## How it works

- `src/fetch_data.py` — pulls the league from ESPN (`espn_api`) and writes
  `docs/data/league_data.json` plus one `docs/data/week_<N>.json` per week.
  Reads `FF_LEAGUE_ID`, `FF_SEASON_YEAR`, `FF_PLAYOFF_CUTOFF`, and
  `ESPN_S2` / `SWID` from the environment.
- `src/week_data.py` — the pure per-week transforms the fetcher runs on each
  week's box scores: week status (upcoming / in-progress / final), position
  buckets, top scorers and the standings accumulation over final weeks only,
  plus the week file the Scoreboard reads (matchups, projected totals, leaders,
  each team's lineup and bench, and the week's projected standings) and the
  rule deciding whether a run publishes what it fetched at all.
- `docs/` — the static site: the Chart.js playoff-position chart and standings
  table, the Scoreboard's per-week matchup cards and projected standings, the
  matchup page one of those cards opens (`matchup.html?week=N&team=ABBREV`),
  and the position pivot. `docs/js/movement.js` draws the rank-movement
  indicator for the standings table and the projected standings alike.
- `.github/workflows/update_data.yml` — refreshes the data daily (7 AM UTC) and
  commits it. The site becomes the 2026 site on kickoff week — the first run
  whose fetched week kicks off within seven days, not the first run ESPN
  answers, since it serves next season's schedule and rosters weeks early. That
  run publishes the standings (empty until a week is final) and the week's
  file, so the Week 1 preview is up before Week 1 is done. Until then it leaves
  the most recent completed season in place.

## Local run

```bash
FF_LEAGUE_ID=xxxxx FF_SEASON_YEAR=2026 FF_PLAYOFF_CUTOFF=6 \
  ESPN_S2=... SWID=... python3 src/fetch_data.py
python3 -m http.server 8080 --directory docs/   # http://localhost:8080
```

## Tests

A Playwright suite loads the site in Chromium against a frozen copy of the
league data (`tests/fixtures/league_data.json`) and two hand-built week files,
one week in progress and one final, so it never depends on the daily data
commit and needs no credentials. The week fixtures are written to the week
file's full shape from the spec, lineups and benches included, which is what
`build_week_file` emits:

```bash
npm install
npx playwright install chromium
npm test
```

A pytest suite covers the pure per-week transforms in `src/week_data.py` —
week finality, position buckets, top scorers, the standings accumulation, and
the week file's matchups, projected totals, leaders, lineups and projected
standings — against hand-built stand-ins, so it needs neither ESPN nor
`espn_api`:

```bash
pip install pytest
pytest tests/python
```

Both run in GitHub Actions on every push and pull request.

Deployed via GitHub Pages from the `docs/` folder on `main`.

## Later

Ideas deliberately left out of the current work, so they aren't forgotten:

- **Game-day refresh every 30 minutes** as the first step toward live-ish
  tracking. Workflow-only change; see
  [ADR 0001](docs/adr/0001-nightly-snapshots-not-live-fetch.md).
- **Full-league matchup view.** Because standings rank every team against the
  whole field, the head-to-head matchup page only tells part of the story. Explore
  a view that lines up every team's starters and projected totals against each
  other at once, the way the matchup page does for two teams.
