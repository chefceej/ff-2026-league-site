# Fantasy Football League Standings

A static site showing cumulative **ranking-point** standings for our ESPN
fantasy football league, normalized so the playoff-cutoff team sits at 0.

Each week, teams are ranked by score (best gets *N* points, worst gets 1, ties
averaged); those points accumulate all season, then the total is shifted so
**6th place = 0** — positive means you're in the playoff picture.

## How it works

- `src/fetch_data.py` — pulls the league from ESPN (`espn_api`) and writes
  `docs/data/league_data.json`. Reads `FF_LEAGUE_ID`, `FF_SEASON_YEAR`,
  `FF_PLAYOFF_CUTOFF`, and `ESPN_S2` / `SWID` from the environment.
- `docs/` — the static site (Chart.js playoff-position chart + standings table).
- `.github/workflows/update_data.yml` — refreshes the data daily (7 AM UTC) and
  commits it. Once the 2026 season kicks off it populates automatically; until
  then it leaves the most recent completed season in place.

## Local run

```bash
FF_LEAGUE_ID=xxxxx FF_SEASON_YEAR=2026 FF_PLAYOFF_CUTOFF=6 \
  ESPN_S2=... SWID=... python3 src/fetch_data.py
python3 -m http.server 8080 --directory docs/   # http://localhost:8080
```

## Tests

A Playwright suite loads the site in Chromium against a frozen copy of the
league data (`tests/fixtures/league_data.json`), so it never depends on the
daily data commit and needs no credentials:

```bash
npm install
npx playwright install chromium
npm test
```

It also runs in GitHub Actions on every push and pull request.

Deployed via GitHub Pages from the `docs/` folder on `main`.
