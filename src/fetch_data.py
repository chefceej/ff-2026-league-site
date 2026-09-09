"""
Fetch ESPN fantasy FOOTBALL league data -> docs/data/.

Writes the season's standings to league_data.json and one matchup file per
week to week_<N>.json, so the Scoreboard loads only the week on screen.

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

from week_data import (accumulate_weeks, build_week, build_week_file,
                       owner_name, weeks_to_fetch)

# ---------------------------------------------------------------------------
# Config (env-driven; no secrets in source)
# ---------------------------------------------------------------------------
LEAGUE_ID = os.environ.get("FF_LEAGUE_ID")          # required
SEASON_YEAR = int(os.environ.get("FF_SEASON_YEAR", "2026"))
PLAYOFF_CUTOFF = int(os.environ.get("FF_PLAYOFF_CUTOFF", "6"))  # zero-line rank
ESPN_S2 = os.environ.get("ESPN_S2")
SWID = os.environ.get("SWID")

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "data")
OUTPUT_PATH = os.path.join(DATA_DIR, "league_data.json")


def week_path(week):
    """Where one week's matchups are published. One file per week is what lets
    the Scoreboard load only the week on screen (spec 05, user story 39)."""
    return os.path.join(DATA_DIR, f"week_{week}.json")


def fetch_boxes(league, week):
    """One week's box scores, or None if ESPN would not serve them."""
    try:
        return league.box_scores(week)
    except Exception as e:
        print(f"  week {week}: box_scores failed ({e})")
        return None


def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(payload, f, indent=1)


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

    now_utc = datetime.now(timezone.utc)
    fetched_at = now_utc.isoformat().replace("+00:00", "Z")

    team_meta = {}
    for t in teams:
        owner = owner_name(t)
        team_meta[t.team_id] = {
            "team_id": t.team_id,
            "team_name": t.team_name,
            "team_abbrev": getattr(t, "team_abbrev", ""),
            "abbrev": getattr(t, "team_abbrev", ""),
            "owner": owner,
        }

    weeks = []
    week_files = []
    for week in weeks_to_fetch(reg_weeks, getattr(league, "current_week", None)):
        boxes = fetch_boxes(league, week)
        if boxes is None:
            continue
        wk = build_week(boxes, week)
        print(f"  week {week}: {wk['status']}")
        weeks.append(wk)
        # Built from the same box scores whatever the week's status, because a
        # preview of an unfinished week is the point. Written further down,
        # once the run knows it is publishing this season at all.
        # is_playoff is always False while weeks_to_fetch stops at the last
        # regular-season week; the playoff walk is a later ticket.
        week_files.append(build_week_file(boxes, week, SEASON_YEAR,
                                          is_playoff=week > reg_weeks,
                                          fetched_at=fetched_at))

    standings = accumulate_weeks(weeks, team_meta, PLAYOFF_CUTOFF)
    final_weeks = standings["final_weeks"]
    if standings["stopped_at_week"]:
        # Loud on purpose: the run still publishes, so a red X is not the
        # signal. Weeks after the gap wait for a run that can number them.
        print(f"!! week {standings['stopped_at_week']} is missing or unfinished"
              f"; standings stop after week {final_weeks}. Later weeks are "
              f"held back until it lands.")
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

    out = {
        "metadata": {
            "league_id": int(LEAGUE_ID),
            "season": SEASON_YEAR,
            "num_teams": num_teams,
            "regular_season_weeks": reg_weeks,
            "completed_weeks": final_weeks,
            # aliases matching the baseball site's shape (used by the shared JS):
            "current_matchup_week": final_weeks,
            "total_matchup_weeks": reg_weeks,
            "playoff_cutoff": PLAYOFF_CUTOFF,
            # The weeks the Scoreboard can open, and the one it opens on.
            # Distinct from current_matchup_week above, which is an alias for
            # the count of FINAL weeks that the standings and pivot read; this
            # is the NFL week the site is currently previewing. The current
            # week is the last week with a file rather than ESPN's own
            # current_week, so the page never opens on a week nobody wrote.
            "week_files": [w["week"] for w in week_files],
            "current_week": week_files[-1]["week"] if week_files else None,
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
    if final_weeks == 0 and os.path.exists(OUTPUT_PATH):
        # The week files wait with it. Publishing them now would overwrite last
        # season's week_1.json while the standings still describe last season,
        # so the Scoreboard would open a week from the wrong year. Both files
        # start flowing together when the rollover ticket retires this guard.
        print(f"0 final weeks for {SEASON_YEAR}; keeping existing "
              f"{OUTPUT_PATH} and the previous season's week files untouched.")
        return

    for week_file in week_files:
        write_json(week_path(week_file["week"]), week_file)
    print(f"Wrote {len(week_files)} week file(s) to {DATA_DIR}")
    write_json(OUTPUT_PATH, out)
    print(f"Wrote {OUTPUT_PATH} ({final_weeks} final weeks)")


if __name__ == "__main__":
    main()
