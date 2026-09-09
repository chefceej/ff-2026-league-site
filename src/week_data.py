"""The site's pure league math: box scores in, week structure and standings out.

Two layers, both free of espn_api and of the network, so the tests feed
hand-built stand-ins for the library's box-score objects:

  - per week   : week_status / build_week / build_week_file
  - per season : assign_ranking_points / accumulate_weeks
"""

from datetime import timezone

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


def iso_utc(when):
    """A kickoff as ISO 8601 UTC, or None when ESPN gave no time.

    espn_api builds game_date with datetime.fromtimestamp, which yields a naive
    datetime in the machine's local zone; astimezone reads a naive value as
    local, so this converts rather than mislabels. A run on a UTC CI box and a
    run on a laptop therefore write the same instant.
    """
    if when is None:
        return None
    return when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def weeks_to_fetch(reg_weeks, current_week):
    """The regular-season weeks ESPN can actually answer for, in order.

    espn_api's box_scores(week) has no else branch for a week beyond
    league.current_week: it silently serves the current week's box scores
    instead of the week asked for. Asking for weeks the league has not reached
    therefore hands back the same week over and over, and once that week goes
    final it would be counted once per remaining week of the season. Asking
    only for weeks that exist is what prevents it.
    """
    if current_week is None:          # a season ESPN reports nothing about
        current_week = reg_weeks
    return list(range(1, min(reg_weeks, current_week) + 1))


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


def build_week(boxes, week):
    """One week's box scores -> the week structure the site is built from.

      week            : the week number these box scores were asked for
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
        "week": week,
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

    Position in the returned arrays is what the site reads as the week number,
    so the final weeks accumulated have to be weeks 1..N with nothing missing.
    On a forward gap -- one week's fetch failed, or a postponed game leaves an
    unfinished week between two final ones -- the weeks before the gap are
    still correctly numbered, so they are kept and everything after the gap is
    left for a later run; stopped_at_week names the week that was missing, or
    None. Only a repeated week raises, because a week arriving behind the slot
    it belongs in can never be the start of a correctly numbered season.

      final_weeks             : how many weeks fed the standings
      stopped_at_week         : the missing week the standings stop before
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
    stopped_at_week = None

    for wk in weeks:
        if wk["status"] != "final":
            continue
        expected = len(top_players_by_week) + 1
        if wk["week"] < expected:
            raise ValueError(
                f"week {wk['week']} arrived again after week {expected - 1}: "
                f"the standings are written one week per slot, so counting it "
                f"twice would double every team's ranking points")
        if wk["week"] > expected:
            stopped_at_week = expected
            break
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
        "stopped_at_week": stopped_at_week,
        "teams": teams,
        "top_players_by_week": top_players_by_week,
        "position_scores_by_week": position_scores_by_week,
    }


def owner_name(team):
    """The manager's display name. espn_api hands back a list that holds dicts
    on a modern league and bare strings on an old one, and an empty list on a
    team nobody claimed."""
    owners = getattr(team, "owners", None) or []
    if not owners:
        return ""
    first = owners[0]
    if isinstance(first, dict):
        return (first.get("firstName", "") + " " +
                first.get("lastName", "")).strip()
    return str(first)


def _projected(player):
    return round(float(getattr(player, "projected_points", 0) or 0), 2)


def _actual(player):
    return round(float(getattr(player, "points", 0) or 0), 2)


def _live_points(player):
    """What a starter is worth right now: the actual score once the game is
    played, the projection until then. This is the one blend the projected
    total and the leaders both read (CONTEXT.md, "Projected total").

    A starter on bye is worth nothing either way. They have no game to wait on,
    which is why a week can go final around them -- so carrying their
    projection would push a settled week's projected total above its score.
    """
    if getattr(player, "on_bye_week", False):
        return 0.0
    return _actual(player) if _has_played(player) else _projected(player)


# ESPN's injury statuses, and the tags the pages show for them. A status the
# league does not carry a tag for -- ACTIVE, NORMAL, or None -- shows no tag.
INJURY_TAGS = {
    "QUESTIONABLE": "Q", "DOUBTFUL": "D", "OUT": "O",
    "INJURY_RESERVE": "IR", "SUSPENSION": "SUSP",
}

LEADERS_PER_TEAM = 3


def injury_tag(status):
    return INJURY_TAGS.get(str(status or "").upper(), "")


def _player(pl):
    """One roster player, as both pages read them."""
    return {
        "player_id": getattr(pl, "playerId", None),
        "name": pl.name,
        "pro_team": getattr(pl, "proTeam", "") or "",
        "position": normalize_position(getattr(pl, "position", "") or ""),
        "slot": getattr(pl, "slot_position", "") or "",
        "injury": injury_tag(getattr(pl, "injuryStatus", None)),
        "opponent": getattr(pl, "pro_opponent", "") or "",
        "kickoff": iso_utc(getattr(pl, "game_date", None)),
        "on_bye": bool(getattr(pl, "on_bye_week", False)),
        "played": _has_played(pl),
        "projected": _projected(pl),
        "actual": _actual(pl),
    }


# espn_api's per-week outcome codes. 'U' is a week ESPN has not settled, and it
# is in the list from the moment the schedule exists, so it counts as nothing.
OUTCOME_WIN, OUTCOME_LOSS, OUTCOME_TIE = "W", "L", "T"


def team_record(team, week):
    """The record the team took into `week`.

    espn_api's Team carries the season-to-date wins/losses/ties, and one League
    object builds every week file in a run -- so reading those would stamp
    December's record onto September's box score, and rewrite it again every
    night. outcomes is the per-week result list, index 0 being week 1, so the
    weeks before this one are the record entering it.

    A team whose schedule never loaded has no per-week list to slice; today's
    record beats no record at all, so that is what it falls back to.
    """
    outcomes = getattr(team, "outcomes", None)
    if not outcomes:
        return {"wins": getattr(team, "wins", 0),
                "losses": getattr(team, "losses", 0),
                "ties": getattr(team, "ties", 0)}
    before = [str(o).upper() for o in outcomes[:max(week - 1, 0)]]
    return {"wins": before.count(OUTCOME_WIN),
            "losses": before.count(OUTCOME_LOSS),
            "ties": before.count(OUTCOME_TIE)}


def _side(team, score, lineup, week):
    """One team's half of a matchup, as the Scoreboard and matchup page read it."""
    if team is None or team == 0:      # a playoff bye has no opponent
        return None
    starters = [pl for pl in lineup or [] if is_starter(pl)]
    # A starter on bye is neither played nor still to play: their week is over
    # without a game, which is the same rule that decides the week's finality.
    return {
        "team_id": team.team_id,
        "team_name": team.team_name,
        "abbrev": getattr(team, "team_abbrev", "") or team.team_name,
        "owner": owner_name(team),
        "logo_url": getattr(team, "logo_url", "") or "",
        "record": team_record(team, week),
        "score": round(float(score or 0), 2),
        "projected_total": round(sum(_live_points(pl) for pl in starters), 2),
        "played": sum(1 for pl in starters if _has_played(pl)),
        "to_play": sum(1 for pl in starters
                       if not _has_played(pl)
                       and not getattr(pl, "on_bye_week", False)),
        "leaders": [_player(pl) for pl in
                    sorted(starters, key=_live_points,
                           reverse=True)[:LEADERS_PER_TEAM]],
    }


def _entering_cumulative(standings, week, team_ids):
    """Each team's cumulative ranking points as the week kicked off.

    accumulate_weeks writes one slot per FINAL week, contiguous from week 1, so
    slot `week - 2` is the cumulative through week `week - 1`. Reading the last
    slot instead would count a final week twice: the standings have already
    counted it, and this block adds the week's ranking points itself.

    A week no slot reaches -- week 1, or a week past the one the standings
    stopped at -- falls back to the last slot there is, which is the most the
    standings know. With no standings at all every team starts from nothing,
    which is week 1's own situation.
    """
    teams = (standings or {}).get("teams") or {}
    entering = {}
    for tid in team_ids:
        arrays = teams.get(tid) or {}
        cumulative = arrays.get("cumulative_points_by_week") or []
        index = min(week - 2, len(cumulative) - 1)
        entering[tid] = cumulative[index] if index >= 0 else 0.0
    return entering


def _ranks(points_by_team, order):
    """1-based rank by points, best first, ties settled by `order`.

    Who `order` is decides what a tie means, so the two callers hand in
    different orders on purpose -- see _projected_standings.
    """
    ranked = sorted(order, key=lambda tid: -points_by_team[tid])
    return {tid: i + 1 for i, tid in enumerate(ranked)}


def _projected_standings(sides, standings, week, playoff_cutoff):
    """Where the week would leave the standings, one row per team.

    Ranks the teams by projected total, hands out ranking points with the same
    function the settled standings use, adds them to what each team entered the
    week with, and normalizes against the cutoff team -- so a row reads exactly
    like a Standings row, only a week early. On a final week the projected
    totals are the scores, so the block is the week's actual result.

    Rows come back ordered by projected total, which is the order the
    Scoreboard renders them in.
    """
    totals = {s["team_id"]: s["projected_total"] for s in sides}
    # The standings' delivery order settles ties; a team the standings have
    # never heard of (an expansion team's first week) follows in the week's own
    # order rather than being dropped.
    order = [tid for tid in ((standings or {}).get("teams") or {})
             if tid in totals]
    order += [tid for tid in totals if tid not in order]

    entering = _entering_cumulative(standings, week, order)
    earned = assign_ranking_points(totals, len(totals))
    projected = {tid: round(entering[tid] + earned[tid], 2) for tid in order}
    # A league with fewer teams than the cutoff normalizes against its last
    # team; the real league always has more, but the transform is handed
    # whatever the boxes hold.
    cutoff_index = min(playoff_cutoff, len(projected)) - 1
    cutoff_value = sorted(projected.values(), reverse=True)[cutoff_index]

    # The rank the week would leave a team on: a tie there breaks the way the
    # standings file's own rank column breaks it, which is its delivery order.
    projected_rank = _ranks(projected, order)
    # The rank the team holds now, which the page draws its arrow FROM. Teams
    # level entering the week are settled in the order they sit in after it, so
    # a tie manufactures no movement -- the rule docs/js/charts.js already
    # states for the Standings table. Without it week 1, where every team
    # enters on nothing, would draw a full set of arrows away from an order
    # nobody earned.
    settled_by_now = sorted(order, key=lambda tid: projected_rank[tid])
    current_rank = _ranks(entering, settled_by_now)
    by_id = {s["team_id"]: s for s in sides}
    return [{
        "team_id": tid,
        "team_name": by_id[tid]["team_name"],
        "abbrev": by_id[tid]["abbrev"],
        "projected_total": totals[tid],
        "projected_ranking_points": earned[tid],
        "projected_cumulative": projected[tid],
        "projected_normalized": round(projected[tid] - cutoff_value, 4),
        "current_rank": current_rank[tid],
        "projected_rank": projected_rank[tid],
    } for tid in sorted(order, key=lambda t: -totals[t])]


def build_week_file(boxes, week, season, is_playoff=False, fetched_at=None,
                    standings=None, playoff_cutoff=6):
    """One week's box scores -> the week file the Scoreboard reads.

    Separate from build_week because the two answer different questions from
    the same boxes: build_week feeds the season's standings, this feeds one
    week's page. Both are pure, so neither knows how the other is published.

    `standings` is accumulate_weeks' return through the last final week -- the
    season state the projected standings block is measured from. A playoff week
    gets no block at all: the bracket does not hand out ranking points, so a
    projection of them would be fiction.

    Returns None when ESPN answered with no matchups at all. That is not an
    empty week, it is a week ESPN would not talk about, and a file built from
    it would replace a published week with zero matchups -- which the page has
    no way to tell from a week that simply has no games.
    """
    if not boxes:
        return None
    matchups = [
        {"home": _side(b.home_team, b.home_score, b.home_lineup, week),
         "away": _side(b.away_team, b.away_score, b.away_lineup, week)}
        for b in boxes]
    week_file = {
        "week": week,
        "season": season,
        "is_playoff": is_playoff,
        "status": week_status(boxes),
        "fetched_at": fetched_at,
        "matchups": matchups,
    }
    if not is_playoff:
        sides = [s for m in matchups for s in (m["home"], m["away"]) if s]
        week_file["projected_standings"] = _projected_standings(
            sides, standings, week, playoff_cutoff)
    return week_file
