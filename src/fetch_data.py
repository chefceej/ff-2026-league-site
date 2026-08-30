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


def assign_ranking_points(scores_by_team_id, num_teams):
    """{team_id: score} -> {team_id: ranking_points}. Ties share the average rank.

    Best score gets num_teams points, worst gets 1.
    """
    ordered = sorted(scores_by_team_id.items(), key=lambda x: x[1], reverse=True)
    points = {}
    i = 0
    while i < len(ordered):
        j = i
        while j < len(ordered) - 1 and ordered[j][1] == ordered[j + 1][1]:
            j += 1
        # ranks occupied by the tie group: (num_teams - i) .. (num_teams - j)
        rank_sum = sum(num_teams - k for k in range(i, j + 1))
        avg = rank_sum / (j - i + 1)
        for k in range(i, j + 1):
            points[ordered[k][0]] = avg
        i = j + 1
    return points


def week_scores(league, week):
    """Return {team_id: score} for a week, or None if the week hasn't been played."""
    try:
        boxes = league.box_scores(week)
    except Exception as e:
        print(f"  week {week}: box_scores failed ({e})")
        return None
    scores = {}
    for b in boxes:
        for team, score in ((b.home_team, b.home_score), (b.away_team, b.away_score)):
            # bye weeks / empty slots show up as 0-point placeholders or None teams
            if team is None or team == 0:
                continue
            scores[team.team_id] = score
    if not scores:
        return None
    # a week with every score at 0 hasn't happened yet
    if all(s == 0 for s in scores.values()):
        return None
    return scores


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
            "abbrev": getattr(t, "team_abbrev", ""),
            "owner": owner,
            "week_scores": [],
            "ranking_points_by_week": [],
            "cumulative_points_by_week": [],
            "normalized_by_week": [],
        }

    cumulative = {tid: 0.0 for tid in team_meta}
    completed_weeks = 0
    for week in range(1, reg_weeks + 1):
        scores = week_scores(league, week)
        if scores is None:
            continue
        completed_weeks += 1
        rp = assign_ranking_points(scores, num_teams)
        for tid in team_meta:
            cumulative[tid] += rp.get(tid, 0)
        cutoff_val = sorted(cumulative.values(), reverse=True)[PLAYOFF_CUTOFF - 1]
        for tid, meta in team_meta.items():
            meta["week_scores"].append(round(scores.get(tid, 0), 2))
            meta["ranking_points_by_week"].append(rp.get(tid, 0))
            meta["cumulative_points_by_week"].append(round(cumulative[tid], 2))
            meta["normalized_by_week"].append(
                round(cumulative[tid] - cutoff_val, 4))

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
            "completed_weeks": completed_weeks,
            "playoff_cutoff": PLAYOFF_CUTOFF,
            "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        },
        "teams": teams_out,
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
