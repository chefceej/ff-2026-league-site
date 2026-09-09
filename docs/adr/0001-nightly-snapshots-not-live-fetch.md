# Nightly snapshots from a GitHub Action, not live ESPN fetches in the browser

The league is private, so every ESPN request needs the owner's `ESPN_S2` / `SWID`
cookies, and the site is a public GitHub Pages page. Fetching ESPN from the
browser would ship those cookies to every visitor, so all ESPN data is pulled by
a scheduled GitHub Action (`.github/workflows/update_data.yml`) and committed as
static JSON under `docs/data/`. The trade-off is freshness: the site is only as
current as the last run, and the ESPN FantasyCast-style live scoring is out of
reach. The daily run at 7 AM UTC (2 AM Central) lands after the last Monday night
game ends, so scores are always in by the next morning.

## Known upgrade path

Live-ish tracking is a workflow-only change: add a second `schedule` entry that
runs every 30 minutes on game days (Thursday night, Sunday, Monday night). The
matchup data already carries per-player actual points and a played flag, so no
data-shape or page change is needed. GitHub schedules cron runs on a best-effort
basis and delays of many minutes are common, so treat it as "recent", not live.
