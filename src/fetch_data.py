"""
Fetch ESPN fantasy FOOTBALL league data -> docs/data/league_data.json.

Mirrors the baseball site's standings model:
  - each week, rank all teams by score -> ranking points (num_teams..1, ties averaged)
  - cumulative running total per team
  - normalize so the playoff-cutoff team = 0 (positive = in the playoff picture)

Auth: reads ESPN_S2 / SWID / FF_LEAGUE_ID from environment (never hard-coded here).
Private leagues need the cookies; they're the same ones as your ESPN account, so
the baseball league's cookies work if the football league is on that account.

Run:
    FF_LEAGUE_ID=xxxxx ESPN_S2=... SWID=... python3 src/fetch_data.py
or put them in a local (gitignored) .env and `source` it first.
"""
import json
import os
from datetime import datetime, timezone

# espn_api ships an outdated base URL; patch before importing League.
import espn_api.requests.espn_requests as _espn_req
_espn_req.FANTASY_BASE_ENDPOINT = (
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/")

from espn_api.football import League

from week_data import accumulate_weeks, build_week

# ---------------------------------------------------------------------------
# Config (env-driven; no secrets in source)
# ---------------------------------------------------------------------------
LEAGUE_ID = os.environ.get("FF_LEAGUE_ID")          # required
SEASON_YEAR = int(os.environ.get("FF_SEASON_YEAR", "2026"))
PLAYOFF_CUTOFF = int(os.environ.get("FF_PLAYOFF_CUTOFF", "6"))  # zero-line rank
ESPN_S2 = os.environ.get("ESPN_S2")
SWID = os.environ.get("SWID")

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..",
                           "docs", "data", "league_data.json")


def fetch_week(league, week):
    """The week structure for one week, or None if ESPN would not serve it."""
    try:
        boxes = league.box_scores(week)
    except Exception as e:
        print(f"  week {week}: box_scores failed ({e})")
        return None
    return build_week(boxes)


def main():
    if not LEAGUE_ID:
        raise SystemExit(
            "FF_LEAGUE_ID is not set. Run: FF_LEAGUE_ID=xxxxx ESPN_S2=... "
            "SWID=... python3 src/fetch_data.py")

    league = League(league_id=int(LEAGUE_ID), year=SEASON_YEAR,
                    espn_s2=ESPN_S2, swid=SWID)
    teams = league.teams
    num_teams = len(teams)
    reg_weeks = getattr(league.settings, "reg_season_count", 14)
    print(f"League {LEAGUE_ID} ({SEASON_YEAR}): {num_teams} teams, "
          f"{reg_weeks} regular-season weeks, cutoff at {PLAYOFF_CUTOFF}")

    team_meta = {}
    for t in teams:
        owners = t.owners or []
        if owners and isinstance(owners[0], dict):
            owner = (owners[0].get("firstName", "") + " " +
                     owners[0].get("lastName", "")).strip()
        else:
            owner = str(owners[0]) if owners else ""
        team_meta[t.team_id] = {
            "team_id": t.team_id,
            "team_name": t.team_name,
            "team_abbrev": getattr(t, "team_abbrev", ""),
            "abbrev": getattr(t, "team_abbrev", ""),
            "owner": owner,
        }

    weeks = []
    for week in range(1, reg_weeks + 1):
        wk = fetch_week(league, week)
        if wk is None:
            continue
        print(f"  week {week}: {wk['status']}")
        weeks.append(wk)

    standings = accumulate_weeks(weeks, list(team_meta), num_teams,
                                 PLAYOFF_CUTOFF)
    completed_weeks = standings["final_weeks"]
    top_players_by_week = standings["top_players_by_week"]
    position_scores_by_week = standings["position_scores_by_week"]
    for tid, meta in team_meta.items():
        meta.update(standings["teams"][tid])

    teams_out = sorted(team_meta.values(),
                       key=lambda m: m["cumulative_points_by_week"][-1]
                       if m["cumulative_points_by_week"] else 0, reverse=True)
    for i, m in enumerate(teams_out, 1):
        m["rank"] = i
        m["total_ranking_points"] = (m["cumulative_points_by_week"][-1]
                                     if m["cumulative_points_by_week"] else 0)

    now_utc = datetime.now(timezone.utc)
    out = {
        "metadata": {
            "league_id": int(LEAGUE_ID),
            "season": SEASON_YEAR,
            "num_teams": num_teams,
            "regular_season_weeks": reg_weeks,
            "completed_weeks": completed_weeks,
            # aliases matching the baseball site's shape (used by the shared JS):
            "current_matchup_week": completed_weeks,
            "total_matchup_weeks": reg_weeks,
            "playoff_cutoff": PLAYOFF_CUTOFF,
            "updated_at": now_utc.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "last_updated": now_utc.isoformat(),
        },
        "teams": teams_out,
        "top_players_by_week": top_players_by_week,
        "position_scores_by_week": position_scores_by_week,
    }
    # Don't clobber existing standings with an empty preseason board: if no
    # weeks are done yet but a data file already exists, leave it in place so
    # the site keeps showing the most recent completed season until kickoff.
    if completed_weeks == 0 and os.path.exists(OUTPUT_PATH):
        print(f"0 completed weeks for {SEASON_YEAR}; keeping existing "
              f"{OUTPUT_PATH} untouched.")
        return

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, indent=1)
    print(f"Wrote {OUTPUT_PATH} ({completed_weeks} completed weeks)")


if __name__ == "__main__":
    main()
