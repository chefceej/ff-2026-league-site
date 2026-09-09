"""The site's pure league math: box scores in, week structure and standings out.

Two layers, both free of espn_api and of the network, so the tests feed
hand-built stand-ins for the library's box-score objects:

  - per week   : week_status / build_week
  - per season : assign_ranking_points / accumulate_weeks
"""

# ESPN's Team QB slot: an NFL team's quarterbacks as one unit. The site counts
# it as QB everywhere it groups by position (see CONTEXT.md, "QB slot").
TEAM_QB = "TQB"

# Starting slot -> position bucket for the position-score pivot. A slot in this
# map is what makes a player a starter: these are the slots that score for a
# team, so bench, IR and anything ESPN does not recognize fall out of both the
# pivot and the week's finality.
SLOT_MAP = {
    "QB": "QB", TEAM_QB: "QB", "RB": "RB", "WR": "WR", "TE": "TE",
    "RB/WR/TE": "FLEX", "WR/TE": "FLEX", "FLEX": "FLEX",
    "OP": "OP", "QB/RB/WR/TE": "OP",
    "D/ST": "D/ST", "K": "K",
}

POS_TABS = ["QB", "RB", "WR", "TE"]   # player-type tabs for Top Scorers
TOP_N = 25

POSITION_ALIASES = {TEAM_QB: "QB"}

# espn_api reports game_played as a percentage, but only ever 0 or 100: it
# flips to 100 three hours after kickoff. The nightly run lands hours after the
# last game, so that is accurate for the standings; a future game-day refresh
# would see a game in its first three hours as not yet started (spec 05,
# "Further Notes"), which reads as upcoming rather than in progress.
FULLY_PLAYED = 100


def normalize_position(position):
    return POSITION_ALIASES.get(position, position)


def is_starter(player):
    """True when the player's slot scores for their team this week."""
    return getattr(player, "slot_position", "") in SLOT_MAP


def _starters(boxes):
    """Every starting player on both sides of every matchup in the week."""
    return [pl
            for b in boxes
            for lineup in (b.home_lineup, b.away_lineup)
            for pl in lineup or []
            if is_starter(pl)]


def _has_played(player):
    return float(getattr(player, "game_played", 0) or 0) >= FULLY_PLAYED


def week_status(boxes):
    """Classify one week's box scores: upcoming, in-progress, or final.

    A week is final when every starter has played or is on bye, upcoming when
    no starter has played, and in progress in between. Players on bye never
    play, so they count as neither. A week ESPN serves with no starters at all
    reads as upcoming, which keeps a week the fetcher cannot see out of the
    standings rather than awarding ranking points on it.
    """
    active = [p for p in _starters(boxes)
              if not getattr(p, "on_bye_week", False)]
    if not any(_has_played(p) for p in active):
        return "upcoming"
    if all(_has_played(p) for p in active):
        return "final"
    return "in-progress"


def build_week(boxes):
    """One week's box scores -> the week structure the site is built from.

      status          : "upcoming" | "in-progress" | "final"
      scores          : {team_id: team score}
      top_players     : {"all": [...], "QB": [...], ...} of starter scores
      position_scores : {team_abbrev: {position bucket: points}}
    """
    scores, all_players = {}, []
    position_scores = {}
    for b in boxes:
        for team, score, lineup in (
                (b.home_team, b.home_score, b.home_lineup),
                (b.away_team, b.away_score, b.away_lineup)):
            if team is None or team == 0:
                continue
            scores[team.team_id] = score
            abbrev = getattr(team, "team_abbrev", "") or team.team_name
            slots = position_scores.setdefault(abbrev, {})
            for pl in lineup or []:
                if not is_starter(pl):
                    continue
                bucket = SLOT_MAP[pl.slot_position]
                pts = float(getattr(pl, "points", 0) or 0)
                slots[bucket] = round(slots.get(bucket, 0) + pts, 2)
                all_players.append({
                    "name": pl.name,
                    "pro_team": getattr(pl, "proTeam", ""),
                    "fantasy_team": team.team_name,
                    "position": normalize_position(
                        getattr(pl, "position", "")),
                    "score": round(pts, 2),
                })

    all_players.sort(key=lambda p: p["score"], reverse=True)
    top_players = {"all": all_players[:TOP_N]}
    for pos in POS_TABS:
        top_players[pos] = [p for p in all_players
                            if p["position"] == pos][:TOP_N]
    return {
        "status": week_status(boxes),
        "scores": scores,
        "top_players": top_players,
        "position_scores": position_scores,
    }


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


def accumulate_weeks(weeks, team_ids, playoff_cutoff):
    """Week structures (in week order) -> the season's standings state.

    Only final weeks count: an upcoming or in-progress week contributes no
    scores, ranking points, top scorers or position scores.

      final_weeks             : how many weeks fed the standings
      teams                   : {team_id: {four per-week arrays}}
      top_players_by_week     : one entry per final week
      position_scores_by_week : one entry per final week
    """
    team_ids = list(team_ids)
    num_teams = len(team_ids)
    teams = {tid: {"scores_by_week": [], "ranking_points_by_week": [],
                   "cumulative_points_by_week": [], "normalized_by_week": []}
             for tid in team_ids}
    cumulative = {tid: 0.0 for tid in team_ids}
    top_players_by_week = []
    position_scores_by_week = []

    for wk in weeks:
        if wk["status"] != "final":
            continue
        top_players_by_week.append(wk["top_players"])
        position_scores_by_week.append(wk["position_scores"])
        rp = assign_ranking_points(wk["scores"], num_teams)
        for tid in teams:
            cumulative[tid] += rp.get(tid, 0)
        cutoff_val = sorted(cumulative.values(), reverse=True)[playoff_cutoff - 1]
        for tid, arrays in teams.items():
            arrays["scores_by_week"].append(round(wk["scores"].get(tid, 0), 2))
            arrays["ranking_points_by_week"].append(rp.get(tid, 0))
            arrays["cumulative_points_by_week"].append(round(cumulative[tid], 2))
            arrays["normalized_by_week"].append(
                round(cumulative[tid] - cutoff_val, 4))

    return {
        "final_weeks": len(top_players_by_week),
        "teams": teams,
        "top_players_by_week": top_players_by_week,
        "position_scores_by_week": position_scores_by_week,
    }
