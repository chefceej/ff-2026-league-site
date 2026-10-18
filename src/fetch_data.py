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
from datetime import datetime, timedelta, timezone

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

# Where to write the site data. Defaults to docs/data/league_data.json next to
# this checkout; FF_OUTPUT_PATH lets a scheduled job point a standalone copy of
# this script at whichever checkout actually serves the site.
OUTPUT_PATH = os.environ.get("FF_OUTPUT_PATH") or os.path.join(
    os.path.dirname(__file__), "..", "docs", "data", "league_data.json")


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
    """Deprecated single-purpose helper; see fetch_week."""
    res = fetch_week(league, week)
    return res[0] if res else None


# Lineup slot -> position bucket for the position-score pivot. Bench/IR skipped.
SLOT_MAP = {
    "QB": "QB", "TQB": "QB",   # TQB = Team QB (this league's 2026 format)
    "RB": "RB", "WR": "WR", "TE": "TE",
    "RB/WR/TE": "FLEX", "WR/TE": "FLEX", "FLEX": "FLEX",
    "OP": "OP", "QB/RB/WR/TE": "OP",
    "D/ST": "D/ST", "K": "K",
}
# Player-position labels that should be treated as QB for the Top Scorers tabs.
POS_NORMALIZE = {"TQB": "QB"}
SKIP_SLOTS = {"BE", "IR", "BENCH"}


def game_status(pl, now):
    """Starter's NFL game state: 'bye', 'pre', 'live' or 'final'.

    espn_api's game_date is a naive local datetime (same clock as now). ESPN
    doesn't expose game clock here, so 'live' = kicked off < 3.5h ago.
    """
    if getattr(pl, "on_bye_week", False):
        return "bye"
    gd = getattr(pl, "game_date", None)
    if gd is None:
        return "final"
    if now < gd:
        return "pre"
    return "live" if now < gd + timedelta(hours=3, minutes=30) else "final"


def fetch_week(league, week):
    """Return (scores_by_team_id, top_players, position_scores, live_teams) for
    a played week, else None.

      scores_by_team_id : {team_id: team score}
      top_players       : {"all": [...]} every starter, best score first. The
                          page derives position tabs / filters from this list.
      position_scores   : {team_abbrev: {slot_bucket: points}}
      live_teams        : {team_id: {score, projected, starters: [...]}} for
                          the Live hub (only the current week's is kept)
    """
    try:
        boxes = league.box_scores(week)
    except Exception as e:
        print(f"  week {week}: box_scores failed ({e})")
        return None

    now = datetime.now()   # naive local, to match espn_api's game_date
    scores, all_players = {}, []
    position_scores, live_teams = {}, {}
    for b in boxes:
        for team, score, projected, lineup in (
                (b.home_team, b.home_score, b.home_projected, b.home_lineup),
                (b.away_team, b.away_score, b.away_projected, b.away_lineup)):
            if team is None or team == 0:
                continue
            scores[team.team_id] = score
            starters = []
            live_teams[team.team_id] = {
                "score": round(score, 2),
                "projected": round(projected if projected and projected > 0
                                   else score, 2),
                "starters": starters,
            }
            abbrev = getattr(team, "team_abbrev", "") or team.team_name
            slots = position_scores.setdefault(abbrev, {})
            for pl in lineup or []:
                slot = getattr(pl, "slot_position", "")
                if slot in SKIP_SLOTS:
                    continue
                bucket = SLOT_MAP.get(slot)
                pts = float(getattr(pl, "points", 0) or 0)
                if bucket:
                    slots[bucket] = round(slots.get(bucket, 0) + pts, 2)
                pos = getattr(pl, "position", "")
                all_players.append({
                    "name": pl.name,
                    "pro_team": getattr(pl, "proTeam", ""),
                    "fantasy_team": team.team_name,
                    "position": POS_NORMALIZE.get(pos, pos),
                    "slot": bucket or slot,
                    "score": round(pts, 2),
                })
                gd = getattr(pl, "game_date", None)
                starters.append({
                    "name": pl.name,
                    "position": POS_NORMALIZE.get(pos, pos),
                    "slot": bucket or slot,
                    "pro_team": getattr(pl, "proTeam", ""),
                    "opponent": getattr(pl, "pro_opponent", ""),
                    "points": round(pts, 2),
                    "projected": round(float(
                        getattr(pl, "projected_points", 0) or 0), 2),
                    "status": game_status(pl, now),
                    "kickoff": int(gd.timestamp() * 1000) if gd else None,
                })

    if not scores or all(s == 0 for s in scores.values()):
        return None

    all_players.sort(key=lambda p: p["score"], reverse=True)
    top_players = {"all": all_players}
    return scores, top_players, position_scores, live_teams


LIVE_HISTORY_MAX = 400   # ~10-min snapshots; a full Sunday is ~75


def build_live(live_week, team_meta, now_utc):
    """Current-week block for live.html: per-team score/projection/starters
    plus a snapshot history so the page can replay the week's rank race.

    History is carried over from the previous data file while the week is the
    same, and a snapshot is only appended when some score actually moved.
    """
    prev = {}
    try:
        with open(OUTPUT_PATH) as f:
            prev = json.load(f).get("live") or {}
    except (OSError, ValueError):
        pass
    if live_week is None:
        return prev or None
    week, live_teams = live_week
    teams = {}
    for tid, info in live_teams.items():
        if tid in team_meta:
            teams[team_meta[tid]["team_abbrev"] or str(tid)] = info
    history = prev.get("history", []) if prev.get("week") == week else []
    snap = {a: t["score"] for a, t in teams.items()}
    if not history or history[-1]["scores"] != snap:
        history.append({"t": now_utc.isoformat(timespec="seconds"),
                        "scores": snap})
    return {
        "week": week,
        "updated_at": now_utc.isoformat(timespec="seconds"),
        "teams": teams,
        "history": history[-LIVE_HISTORY_MAX:],
    }


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
            "scores_by_week": [],
            "ranking_points_by_week": [],
            "cumulative_points_by_week": [],
            "normalized_by_week": [],
        }

    # ESPN's box_scores() happily returns the *current* week's live scores for
    # any future week you ask for, so blindly looping 1..reg_weeks would treat
    # every remaining week as "played" with duplicate numbers. Bound the loop to
    # the current NFL scoring period; weeks past it haven't happened yet.
    current = (getattr(league, "current_week", None)
               or getattr(league, "nfl_week", None) or reg_weeks)
    max_week = max(1, min(reg_weeks, current))
    print(f"Current scoring week: {current} -> fetching weeks 1..{max_week}")

    live_week = None
    cumulative = {tid: 0.0 for tid in team_meta}
    completed_weeks = 0
    top_players_by_week = []
    position_scores_by_week = []
    for week in range(1, max_week + 1):
        res = fetch_week(league, week)
        if res is None:
            continue
        scores, top_players, pos_scores, live_teams = res
        live_week = (week, live_teams)
        completed_weeks += 1
        top_players_by_week.append(top_players)
        position_scores_by_week.append(pos_scores)
        rp = assign_ranking_points(scores, num_teams)
        for tid in team_meta:
            cumulative[tid] += rp.get(tid, 0)
        cutoff_val = sorted(cumulative.values(), reverse=True)[PLAYOFF_CUTOFF - 1]
        for tid, meta in team_meta.items():
            meta["scores_by_week"].append(round(scores.get(tid, 0), 2))
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
        "live": build_live(live_week, team_meta, now_utc),
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
