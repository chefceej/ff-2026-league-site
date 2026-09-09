"""Tests for the pure per-week transform.

Stand-ins mimic the espn_api box-score objects the fetcher actually sees:
a BoxScore with home/away team, score and lineup, and BoxPlayers carrying
slot_position, position, points, game_played (0-100) and on_bye_week.
"""
from datetime import datetime, timedelta, timezone

import pytest

from week_data import (accumulate_weeks, assign_ranking_points,
                       build_week, build_week_file, near_kickoff,
                       publishes_this_season, team_record, week_status,
                       weeks_to_fetch)


class FakePlayer:
    def __init__(self, name="Player", slot="QB", position="QB", points=0.0,
                 game_played=0, on_bye_week=False, pro_team="NE",
                 projected=0.0, player_id=0, injury=None, opponent="",
                 game_date=None):
        self.name = name
        self.slot_position = slot
        self.position = position
        self.points = points
        self.game_played = game_played
        self.on_bye_week = on_bye_week
        self.proTeam = pro_team
        self.projected_points = projected
        self.playerId = player_id
        self.injuryStatus = injury
        self.pro_opponent = opponent
        self.game_date = game_date


class FakeTeam:
    def __init__(self, team_id, name=None, abbrev=None, owners=None,
                 wins=0, losses=0, ties=0, logo_url="", outcomes=None):
        self.team_id = team_id
        self.team_name = name or f"Team {team_id}"
        self.team_abbrev = abbrev or f"T{team_id}"
        self.owners = owners if owners is not None else []
        self.wins = wins
        self.losses = losses
        self.ties = ties
        self.logo_url = logo_url
        # espn_api's per-week result list: 'W', 'L', 'T', or 'U' while the week
        # is undecided, one entry per scheduled week with index 0 as week 1.
        self.outcomes = outcomes if outcomes is not None else []


class FakeBox:
    def __init__(self, home_team, home_score, home_lineup,
                 away_team, away_score, away_lineup):
        self.home_team = home_team
        self.home_score = home_score
        self.home_lineup = home_lineup
        self.away_team = away_team
        self.away_score = away_score
        self.away_lineup = away_lineup


def box(home_lineup, away_lineup, home_score=0.0, away_score=0.0):
    return FakeBox(FakeTeam(1), home_score, home_lineup,
                   FakeTeam(2), away_score, away_lineup)


def test_week_with_no_started_game_is_upcoming():
    boxes = [box([FakePlayer(game_played=0)], [FakePlayer(game_played=0)])]
    assert week_status(boxes) == "upcoming"


def test_week_with_one_unstarted_starter_is_not_final():
    boxes = [box([FakePlayer(name="Played", game_played=100)],
                 [FakePlayer(name="Waiting", game_played=0)])]
    assert week_status(boxes) == "in-progress"


def test_week_is_final_when_every_starter_played_or_is_on_bye():
    boxes = [box([FakePlayer(name="Played", game_played=100),
                  FakePlayer(name="Bye", game_played=0, on_bye_week=True)],
                 [FakePlayer(name="Also played", game_played=100)])]
    assert week_status(boxes) == "final"


def test_an_unplayed_bench_player_does_not_hold_a_week_open():
    boxes = [box([FakePlayer(name="Played", game_played=100),
                  FakePlayer(name="Benched", slot="BE", game_played=0)],
                 [FakePlayer(name="Also played", game_played=100)])]
    assert week_status(boxes) == "final"


def test_a_week_espn_serves_with_no_lineups_is_upcoming():
    assert week_status([box([], [])]) == "upcoming"


def test_build_week_reports_scores_and_status():
    boxes = [box([FakePlayer(name="Played", game_played=100, points=20.0)],
                 [FakePlayer(name="Also played", game_played=100, points=11.5)],
                 home_score=20.0, away_score=11.5)]
    wk = build_week(boxes, week=1)
    assert wk["status"] == "final"
    assert wk["scores"] == {1: 20.0, 2: 11.5}


def test_build_week_buckets_starter_points_by_position_per_team():
    boxes = [box([FakePlayer(name="Passer", slot="QB", points=20.0),
                  FakePlayer(name="Runner", slot="RB", points=8.0),
                  FakePlayer(name="Flexed", slot="RB/WR/TE", points=5.0),
                  FakePlayer(name="Benched", slot="BE", points=99.0)],
                 [FakePlayer(name="Other passer", slot="QB", points=13.0)])]
    wk = build_week(boxes, week=1)
    assert wk["position_scores"]["T1"] == {"QB": 20.0, "RB": 8.0, "FLEX": 5.0}
    assert wk["position_scores"]["T2"] == {"QB": 13.0}


def test_build_week_ranks_starters_into_all_and_position_tabs():
    boxes = [box([FakePlayer(name="Passer", slot="QB", position="QB", points=20.0),
                  FakePlayer(name="Runner", slot="RB", position="RB", points=8.0)],
                 [FakePlayer(name="Other passer", slot="QB", position="QB",
                             points=13.0)])]
    wk = build_week(boxes, week=1)
    assert [p["name"] for p in wk["top_players"]["all"]] == [
        "Passer", "Other passer", "Runner"]
    assert [p["name"] for p in wk["top_players"]["QB"]] == [
        "Passer", "Other passer"]
    assert wk["top_players"]["all"][0] == {
        "name": "Passer", "pro_team": "NE", "fantasy_team": "Team 1",
        "position": "QB", "score": 20.0}


def test_team_qb_points_land_in_the_qb_position_bucket():
    boxes = [box([FakePlayer(name="Chiefs QB", slot="TQB", position="TQB",
                             points=24.5, pro_team="KC")],
                 [FakePlayer(name="Passer", slot="QB", position="QB",
                             points=13.0)])]
    wk = build_week(boxes, week=1)
    assert wk["position_scores"]["T1"] == {"QB": 24.5}


def test_team_qb_players_appear_in_the_qb_top_scorers_tab():
    boxes = [box([FakePlayer(name="Chiefs QB", slot="TQB", position="TQB",
                             points=24.5, pro_team="KC")],
                 [FakePlayer(name="Passer", slot="QB", position="QB",
                             points=13.0)])]
    wk = build_week(boxes, week=1)
    assert [p["name"] for p in wk["top_players"]["QB"]] == [
        "Chiefs QB", "Passer"]
    assert wk["top_players"]["QB"][0]["position"] == "QB"


def test_best_score_takes_the_most_ranking_points_and_worst_takes_one():
    points = assign_ranking_points({1: 100.0, 2: 90.0, 3: 80.0}, num_teams=3)
    assert points == {1: 3, 2: 2, 3: 1}


def test_tied_scores_share_the_average_of_the_ranks_they_occupy():
    # Ranks 3 and 2 are occupied by the tie, so both teams take 2.5.
    points = assign_ranking_points({1: 90.0, 2: 90.0, 3: 80.0}, num_teams=3)
    assert points == {1: 2.5, 2: 2.5, 3: 1}


def week(number, status, scores):
    return {"week": number, "status": status, "scores": scores,
            "top_players": {"all": []}, "position_scores": {}}


def test_an_in_progress_week_is_absent_from_the_standings_arrays():
    weeks = [week(1, "final", {1: 100.0, 2: 90.0}),
             week(2, "in-progress", {1: 40.0, 2: 10.0})]
    standings = accumulate_weeks(weeks, team_ids=[1, 2], playoff_cutoff=1)
    assert standings["final_weeks"] == 1
    assert standings["teams"][1]["scores_by_week"] == [100.0]
    assert standings["teams"][1]["ranking_points_by_week"] == [2]
    assert standings["teams"][2]["scores_by_week"] == [90.0]


def test_upcoming_and_in_progress_weeks_contribute_no_top_scorers_or_positions():
    final = week(1, "final", {1: 100.0, 2: 90.0})
    final["top_players"] = {"all": [{"name": "Passer"}]}
    final["position_scores"] = {"T1": {"QB": 20.0}}
    in_progress = week(2, "in-progress", {1: 40.0, 2: 10.0})
    in_progress["top_players"] = {"all": [{"name": "Half a game"}]}
    in_progress["position_scores"] = {"T1": {"QB": 8.0}}
    standings = accumulate_weeks([final, in_progress], team_ids=[1, 2],
                                 playoff_cutoff=1)
    assert standings["top_players_by_week"] == [{"all": [{"name": "Passer"}]}]
    assert standings["position_scores_by_week"] == [{"T1": {"QB": 20.0}}]


def test_cumulative_points_are_normalized_against_the_cutoff_team():
    weeks = [week(1, "final", {1: 100.0, 2: 90.0, 3: 80.0}),
             week(2, "final", {1: 100.0, 2: 95.0, 3: 99.0})]
    standings = accumulate_weeks(weeks, team_ids=[1, 2, 3],
                                 playoff_cutoff=2)
    # Cumulative after two weeks: team 1 = 6, team 3 = 3, team 2 = 3.
    assert standings["teams"][1]["cumulative_points_by_week"] == [3, 6]
    assert standings["teams"][2]["cumulative_points_by_week"] == [2, 3]
    # 2nd-best cumulative is 3 both weeks, so it sits at 0 and the leader above.
    assert standings["teams"][1]["normalized_by_week"] == [1, 3]
    assert standings["teams"][2]["normalized_by_week"] == [0, 0]


def test_a_slot_that_scores_for_nobody_does_not_hold_a_week_open():
    # ESPN's BoxPlayer defaults slot_position to "FA", and the slot map has no
    # bucket for it, so it scores for no team; it must not gate finality either.
    boxes = [box([FakePlayer(name="Played", game_played=100),
                  FakePlayer(name="Stray", slot="FA", game_played=0)],
                 [FakePlayer(name="Also played", game_played=100)])]
    assert week_status(boxes) == "final"


def test_a_slot_that_scores_for_nobody_is_left_out_of_the_top_scorers():
    boxes = [box([FakePlayer(name="Passer", slot="QB", points=20.0),
                  FakePlayer(name="Stray", slot="FA", points=99.0)],
                 [FakePlayer(name="Other passer", slot="QB", points=13.0)])]
    wk = build_week(boxes, week=1)
    assert [p["name"] for p in wk["top_players"]["all"]] == [
        "Passer", "Other passer"]


# ── The week number: what keeps one week from being counted as several ──

def test_the_fetcher_asks_only_for_weeks_the_league_has_reached():
    # espn_api's box_scores(week) has no else branch for a week past
    # league.current_week: it quietly serves the CURRENT week instead. Asking
    # for weeks 2..14 during week 1 would hand back week 1 thirteen more times.
    assert weeks_to_fetch(reg_weeks=14, current_week=1) == [1]
    assert weeks_to_fetch(reg_weeks=14, current_week=5) == [1, 2, 3, 4, 5]
    assert weeks_to_fetch(reg_weeks=14, current_week=14) == list(range(1, 15))


def test_the_fetcher_stops_at_the_last_regular_season_week():
    # Playoff weeks run past reg_season_count; the standings end there.
    assert weeks_to_fetch(reg_weeks=14, current_week=17) == list(range(1, 15))


def test_the_fetcher_asks_for_nothing_before_the_season_starts():
    assert weeks_to_fetch(reg_weeks=14, current_week=0) == []


def test_build_week_carries_the_week_it_was_asked_for():
    wk = build_week([box([FakePlayer()], [FakePlayer()])], week=7)
    assert wk["week"] == 7


def test_the_same_week_twice_is_refused():
    # A repeat can never be the start of a correctly numbered season, so there
    # is no prefix to salvage: counting it would double every team's points.
    duplicated = [week(1, "final", {1: 100.0, 2: 90.0}),
                  week(1, "final", {1: 100.0, 2: 90.0})]
    with pytest.raises(ValueError, match="week 1"):
        accumulate_weeks(duplicated, team_ids=[1, 2], playoff_cutoff=1)


def test_a_missing_week_publishes_the_weeks_before_it_and_stops():
    # Week 2's fetch failed. Week 1 is correctly numbered and safe to publish;
    # week 3 is not, because it would land in week 2's slot and read as W2.
    with_gap = [week(1, "final", {1: 100.0, 2: 90.0}),
                week(3, "final", {1: 80.0, 2: 95.0})]
    standings = accumulate_weeks(with_gap, team_ids=[1, 2], playoff_cutoff=1)
    assert standings["final_weeks"] == 1
    assert standings["stopped_at_week"] == 2
    assert standings["teams"][1]["scores_by_week"] == [100.0]
    assert standings["teams"][2]["scores_by_week"] == [90.0]


def test_an_unfinished_week_between_final_ones_stops_the_standings_there():
    # A postponed game keeps week 2 in progress while week 3 finishes. Week 3
    # waits; week 1 still publishes, so the site does not freeze meanwhile.
    postponed = [week(1, "final", {1: 100.0, 2: 90.0}),
                 week(2, "in-progress", {1: 40.0, 2: 10.0}),
                 week(3, "final", {1: 80.0, 2: 95.0})]
    standings = accumulate_weeks(postponed, team_ids=[1, 2], playoff_cutoff=1)
    assert standings["final_weeks"] == 1
    assert standings["stopped_at_week"] == 2
    assert standings["teams"][1]["scores_by_week"] == [100.0]


def test_a_season_with_no_gap_stops_nowhere():
    weeks = [week(1, "final", {1: 100.0, 2: 90.0}),
             week(2, "final", {1: 80.0, 2: 95.0})]
    standings = accumulate_weeks(weeks, team_ids=[1, 2], playoff_cutoff=1)
    assert standings["final_weeks"] == 2
    assert standings["stopped_at_week"] is None



def test_an_unfinished_week_after_the_last_final_one_is_fine():
    weeks = [week(1, "final", {1: 100.0, 2: 90.0}),
             week(2, "final", {1: 80.0, 2: 95.0}),
             week(3, "in-progress", {1: 40.0, 2: 10.0}),
             week(4, "upcoming", {1: 0.0, 2: 0.0})]
    standings = accumulate_weeks(weeks, team_ids=[1, 2], playoff_cutoff=1)
    assert standings["final_weeks"] == 2


# ── The week file: one week's matchups as the Scoreboard reads them ──

def test_build_week_file_carries_the_weeks_identity_and_status():
    boxes = [box([FakePlayer(game_played=100)], [FakePlayer(game_played=100)])]
    wf = build_week_file(boxes, week=3, season=2026, is_playoff=False,
                         fetched_at="2026-09-09T00:00:00Z")
    assert wf["week"] == 3
    assert wf["season"] == 2026
    assert wf["is_playoff"] is False
    assert wf["status"] == "final"
    assert wf["fetched_at"] == "2026-09-09T00:00:00Z"


def test_the_week_file_names_both_teams_of_every_matchup():
    home = FakeTeam(1, name="Home Team", abbrev="HOME", wins=3, losses=1,
                    ties=1, logo_url="https://logos/1.png",
                    owners=[{"firstName": "Ada", "lastName": "Lovelace"}])
    away = FakeTeam(2, name="Away Team", abbrev="AWAY", wins=2, losses=3)
    boxes = [FakeBox(home, 91.5, [FakePlayer(game_played=100, points=91.5)],
                     away, 80.0, [FakePlayer(game_played=100, points=80.0)])]
    wf = build_week_file(boxes, week=5, season=2026)

    assert len(wf["matchups"]) == 1
    side = wf["matchups"][0]["home"]
    assert side["team_id"] == 1
    assert side["team_name"] == "Home Team"
    assert side["abbrev"] == "HOME"
    assert side["owner"] == "Ada Lovelace"
    assert side["logo_url"] == "https://logos/1.png"
    assert side["record"] == {"wins": 3, "losses": 1, "ties": 1}
    assert side["score"] == 91.5
    assert wf["matchups"][0]["away"]["abbrev"] == "AWAY"


def test_projected_total_blends_played_actuals_with_unplayed_projections():
    home = [FakePlayer(name="Done", game_played=100, points=20.0, projected=15.0),
            FakePlayer(name="Waiting", slot="RB", projected=12.5)]
    away = [FakePlayer(name="Also done", game_played=100, points=9.0,
                       projected=8.0)]
    boxes = [FakeBox(FakeTeam(1), 20.0, home, FakeTeam(2), 9.0, away)]
    wf = build_week_file(boxes, week=2, season=2026)

    assert wf["status"] == "in-progress"
    side = wf["matchups"][0]["home"]
    assert side["projected_total"] == 32.5
    assert side["played"] == 1
    assert side["to_play"] == 1


def test_a_final_weeks_projected_total_is_the_score_it_already_has():
    # Every starter has played, so the blend has nothing left to project and
    # the "projected" total reads as the box score (spec 05, projected total).
    home = [FakePlayer(name="One", game_played=100, points=20.0, projected=15.0),
            FakePlayer(name="Two", slot="RB", game_played=100, points=11.25,
                       projected=9.0)]
    away = [FakePlayer(name="Three", game_played=100, points=9.0, projected=8.0)]
    boxes = [FakeBox(FakeTeam(1), 31.25, home, FakeTeam(2), 9.0, away)]
    wf = build_week_file(boxes, week=2, season=2026)

    assert wf["status"] == "final"
    side = wf["matchups"][0]["home"]
    assert side["projected_total"] == side["score"] == 31.25
    assert (side["played"], side["to_play"]) == (2, 0)


def test_a_starter_on_bye_is_counted_as_neither_played_nor_still_to_play():
    home = [FakePlayer(name="Done", game_played=100, points=20.0, projected=15.0),
            FakePlayer(name="Idle", slot="RB", on_bye_week=True)]
    away = [FakePlayer(name="Also done", game_played=100, points=9.0)]
    boxes = [FakeBox(FakeTeam(1), 20.0, home, FakeTeam(2), 9.0, away)]
    side = build_week_file(boxes, week=2, season=2026)["matchups"][0]["home"]

    assert (side["played"], side["to_play"]) == (1, 0)


def test_leaders_are_the_three_best_starters_by_actual_if_played_else_projected():
    home = [
        FakePlayer(name="Played big", game_played=100, points=28.0,
                   projected=10.0),
        FakePlayer(name="Projected big", slot="RB", projected=22.0),
        # Projected highest of anyone, but its game is over and it busted, so
        # the actual is what ranks it: fourth, and out of the leaders.
        FakePlayer(name="Played small", slot="WR", game_played=100, points=4.0,
                   projected=30.0),
        FakePlayer(name="Middling", slot="TE", projected=11.0),
        FakePlayer(name="Benched", slot="BE", projected=99.0),
    ]
    boxes = [FakeBox(FakeTeam(1), 32.0, home, FakeTeam(2), 0.0,
                     [FakePlayer(name="Lonely")])]
    side = build_week_file(boxes, week=2, season=2026)["matchups"][0]["home"]

    assert [p["name"] for p in side["leaders"]] == [
        "Played big", "Projected big", "Middling"]
    assert [p["projected"] for p in side["leaders"]] == [10.0, 22.0, 11.0]
    assert [p["actual"] for p in side["leaders"]] == [28.0, 0.0, 0.0]
    assert [p["played"] for p in side["leaders"]] == [True, False, False]


def test_a_team_with_fewer_than_three_starters_leads_with_what_it_has():
    boxes = [FakeBox(FakeTeam(1), 5.0, [FakePlayer(name="Only one", projected=5.0)],
                     FakeTeam(2), 0.0, [FakePlayer(name="Lonely")])]
    side = build_week_file(boxes, week=2, season=2026)["matchups"][0]["home"]
    assert [p["name"] for p in side["leaders"]] == ["Only one"]


@pytest.mark.parametrize("status, tag", [
    ("QUESTIONABLE", "Q"),
    ("DOUBTFUL", "D"),
    ("OUT", "O"),
    ("INJURY_RESERVE", "IR"),
    ("SUSPENSION", "SUSP"),
    ("ACTIVE", ""),
    ("NORMAL", ""),
    (None, ""),
])
def test_espn_injury_statuses_map_to_the_leagues_tags(status, tag):
    boxes = [FakeBox(FakeTeam(1), 5.0,
                     [FakePlayer(name="Hurting", projected=5.0, injury=status)],
                     FakeTeam(2), 0.0, [FakePlayer(name="Lonely")])]
    side = build_week_file(boxes, week=2, season=2026)["matchups"][0]["home"]
    assert side["leaders"][0]["injury"] == tag


def test_a_kickoff_is_written_as_iso_8601_utc_whatever_zone_espn_used():
    # 1:00 pm on the US east coast in September is 5:00 pm UTC.
    kick = datetime(2026, 9, 13, 13, 0,
                    tzinfo=timezone(timedelta(hours=-4)))
    boxes = [FakeBox(FakeTeam(1), 5.0,
                     [FakePlayer(name="Starter", projected=5.0, game_date=kick)],
                     FakeTeam(2), 0.0, [FakePlayer(name="Lonely")])]
    side = build_week_file(boxes, week=2, season=2026)["matchups"][0]["home"]
    assert side["leaders"][0]["kickoff"] == "2026-09-13T17:00:00Z"


def test_a_player_with_no_kickoff_carries_none_rather_than_a_made_up_time():
    boxes = [FakeBox(FakeTeam(1), 5.0,
                     [FakePlayer(name="On bye", projected=0.0, on_bye_week=True)],
                     FakeTeam(2), 0.0, [FakePlayer(name="Lonely")])]
    side = build_week_file(boxes, week=2, season=2026)["matchups"][0]["home"]
    assert side["leaders"][0]["kickoff"] is None
    assert side["leaders"][0]["on_bye"] is True


def test_a_bye_starter_does_not_inflate_a_final_weeks_projected_total():
    # The week is final with a starter on bye, because a bye is not a game
    # anyone is waiting on. That starter can still carry a projection, and
    # counting it would put the projected total above the score it settled at.
    home = [FakePlayer(name="Done", game_played=100, points=20.0, projected=15.0),
            FakePlayer(name="Idle", slot="RB", projected=8.4, on_bye_week=True)]
    away = [FakePlayer(name="Also done", game_played=100, points=9.0)]
    boxes = [FakeBox(FakeTeam(1), 20.0, home, FakeTeam(2), 9.0, away)]
    wf = build_week_file(boxes, week=2, season=2026)

    assert wf["status"] == "final"
    side = wf["matchups"][0]["home"]
    assert side["projected_total"] == side["score"] == 20.0


def test_a_bye_starter_does_not_crowd_out_a_real_leader():
    home = [FakePlayer(name="Playing", projected=6.0),
            FakePlayer(name="Idle", slot="RB", projected=99.0, on_bye_week=True)]
    boxes = [FakeBox(FakeTeam(1), 0.0, home, FakeTeam(2), 0.0,
                     [FakePlayer(name="Lonely")])]
    side = build_week_file(boxes, week=2, season=2026)["matchups"][0]["home"]
    assert [p["name"] for p in side["leaders"]] == ["Playing", "Idle"]


# ── The record a card shows: where the team stood entering that week ──

def test_the_record_counts_only_the_weeks_before_the_one_being_written():
    # One League object builds every week file, so the Team's season-to-date
    # 10-3 must not be stamped onto week 4's card. Entering week 4 this team
    # was 2-1.
    team = FakeTeam(1, wins=10, losses=3,
                    outcomes=["W", "L", "W", "W", "W", "L", "W", "W", "W",
                              "W", "W", "L", "W"])
    assert team_record(team, week=4) == {"wins": 2, "losses": 1, "ties": 0}


def test_entering_week_one_every_team_has_played_nobody():
    team = FakeTeam(1, wins=10, losses=3, outcomes=["W", "L", "W"])
    assert team_record(team, week=1) == {"wins": 0, "losses": 0, "ties": 0}


def test_an_undecided_week_counts_as_neither_a_win_nor_a_loss():
    # ESPN marks a week it has not settled 'U'; it is in the list from the
    # moment the schedule exists, so it must not read as a loss.
    team = FakeTeam(1, outcomes=["W", "U", "U", "U"])
    assert team_record(team, week=4) == {"wins": 1, "losses": 0, "ties": 0}


def test_a_tie_is_counted_as_a_tie():
    team = FakeTeam(1, outcomes=["W", "T", "L"])
    assert team_record(team, week=4) == {"wins": 1, "losses": 1, "ties": 1}


def test_a_team_with_no_outcome_list_falls_back_to_its_season_record():
    # Nothing else in the file can be salvaged from a Team that lost its
    # schedule, and today's record beats no record at all.
    team = FakeTeam(1, wins=6, losses=7, ties=1, outcomes=[])
    assert team_record(team, week=9) == {"wins": 6, "losses": 7, "ties": 1}


def test_the_week_file_carries_the_record_the_team_took_into_the_week():
    home = FakeTeam(1, wins=9, losses=1, outcomes=["W", "W", "L", "W"])
    away = FakeTeam(2, wins=2, losses=8, outcomes=["L", "L", "W", "L"])
    boxes = [FakeBox(home, 20.0, [FakePlayer(game_played=100, points=20.0)],
                     away, 9.0, [FakePlayer(game_played=100, points=9.0)])]
    matchup = build_week_file(boxes, week=3, season=2026)["matchups"][0]

    assert matchup["home"]["record"] == {"wins": 2, "losses": 0, "ties": 0}
    assert matchup["away"]["record"] == {"wins": 0, "losses": 2, "ties": 0}


def test_a_week_espn_answers_with_no_matchups_produces_no_week_file():
    # An empty-but-successful answer is not an empty week; it is a week ESPN
    # would not talk about. Building a file from it would publish a week with
    # zero matchups over a week that already has one, and the Scoreboard would
    # render a blank under a live week label.
    assert build_week_file([], week=7, season=2026,
                           fetched_at="2026-09-09T00:00:00Z") is None


def test_a_week_with_matchups_still_produces_a_week_file():
    boxes = [box([FakePlayer(game_played=100)], [FakePlayer(game_played=100)])]
    assert build_week_file(boxes, week=7, season=2026)["week"] == 7


# ── The projected standings block ──

def four_team_boxes(totals, played=True):
    """Two matchups, four teams, each team's projected total handed in.

    Each team fields one starter worth exactly its total, so ranking the teams
    by projected total is ranking them by the number in `totals`. `played`
    decides whether that number arrives as an actual or as a projection, which
    is what makes the same league read as a final or an unfinished week.
    """
    def side(tid, pts):
        kw = ({"game_played": 100, "points": pts} if played
              else {"game_played": 0, "projected": pts})
        return FakeTeam(tid), (pts if played else 0.0), [FakePlayer(**kw)]

    ids = sorted(totals)
    boxes = []
    for a, b in zip(ids[::2], ids[1::2]):
        ha, hs, hl = side(a, totals[a])
        aa, as_, al = side(b, totals[b])
        boxes.append(FakeBox(ha, hs, hl, aa, as_, al))
    return boxes


def standings_state(cumulative_by_team, weeks=1):
    """A stand-in for accumulate_weeks' return: `weeks` slots per team, the
    last one holding the cumulative ranking points handed in."""
    return {"teams": {tid: {"cumulative_points_by_week":
                            [pts] * weeks}
                      for tid, pts in cumulative_by_team.items()}}


def block_by_abbrev(wf):
    return {row["abbrev"]: row for row in wf["projected_standings"]}


def test_the_block_orders_every_team_by_projected_total():
    boxes = four_team_boxes({1: 90.0, 2: 120.0, 3: 100.0, 4: 80.0}, played=False)
    wf = build_week_file(boxes, week=1, season=2026, playoff_cutoff=2)

    assert [r["abbrev"] for r in wf["projected_standings"]] == \
        ["T2", "T3", "T1", "T4"]
    assert [r["projected_total"] for r in wf["projected_standings"]] == \
        [120.0, 100.0, 90.0, 80.0]


def test_the_block_earns_ranking_points_with_the_standings_own_function():
    totals = {1: 90.0, 2: 120.0, 3: 100.0, 4: 80.0}
    wf = build_week_file(four_team_boxes(totals, played=False), week=1,
                         season=2026, playoff_cutoff=2)

    rows = block_by_abbrev(wf)
    expected = assign_ranking_points(totals, 4)
    assert {tid: rows[f"T{tid}"]["projected_ranking_points"] for tid in totals} \
        == expected
    assert rows["T2"]["projected_ranking_points"] == 4
    assert rows["T4"]["projected_ranking_points"] == 1


def test_teams_tied_on_projected_total_split_the_ranking_points():
    # T2 and T3 tie for the top two ranks (4 and 3), so each takes 3.5 -- the
    # same averaging the settled standings use.
    wf = build_week_file(
        four_team_boxes({1: 90.0, 2: 120.0, 3: 120.0, 4: 80.0}, played=False),
        week=1, season=2026, playoff_cutoff=2)

    rows = block_by_abbrev(wf)
    assert rows["T2"]["projected_ranking_points"] == 3.5
    assert rows["T3"]["projected_ranking_points"] == 3.5
    assert rows["T1"]["projected_ranking_points"] == 2
    assert rows["T4"]["projected_ranking_points"] == 1


def test_the_block_adds_the_week_to_the_cumulative_it_entered_with():
    boxes = four_team_boxes({1: 90.0, 2: 120.0, 3: 100.0, 4: 80.0}, played=False)
    standings = standings_state({1: 10.0, 2: 3.0, 3: 6.0, 4: 20.0}, weeks=3)
    wf = build_week_file(boxes, week=4, season=2026, standings=standings,
                         playoff_cutoff=2)

    rows = block_by_abbrev(wf)
    # entering + this week's ranking points
    assert rows["T2"]["projected_cumulative"] == 7.0     # 3 + 4
    assert rows["T3"]["projected_cumulative"] == 9.0     # 6 + 3
    assert rows["T1"]["projected_cumulative"] == 12.0    # 10 + 2
    assert rows["T4"]["projected_cumulative"] == 21.0    # 20 + 1


def test_the_block_normalizes_against_the_cutoff_teams_projected_cumulative():
    boxes = four_team_boxes({1: 90.0, 2: 120.0, 3: 100.0, 4: 80.0}, played=False)
    standings = standings_state({1: 10.0, 2: 3.0, 3: 6.0, 4: 20.0}, weeks=3)
    wf = build_week_file(boxes, week=4, season=2026, standings=standings,
                         playoff_cutoff=2)

    # Projected cumulatives are 21, 12, 9, 7; the 2nd best is 12, so that team
    # sits on the zero line and everyone else is measured from it.
    rows = block_by_abbrev(wf)
    assert rows["T1"]["projected_normalized"] == 0.0
    assert rows["T4"]["projected_normalized"] == 9.0
    assert rows["T3"]["projected_normalized"] == -3.0
    assert rows["T2"]["projected_normalized"] == -5.0


def test_the_block_records_the_rank_each_team_holds_now_and_would_hold_after():
    boxes = four_team_boxes({1: 90.0, 2: 120.0, 3: 100.0, 4: 80.0}, played=False)
    standings = standings_state({1: 10.0, 2: 3.0, 3: 6.0, 4: 20.0}, weeks=3)
    wf = build_week_file(boxes, week=4, season=2026, standings=standings,
                         playoff_cutoff=2)

    rows = block_by_abbrev(wf)
    # entering: T4 20, T1 10, T3 6, T2 3
    assert [rows[f"T{tid}"]["current_rank"] for tid in (4, 1, 3, 2)] == [1, 2, 3, 4]
    # after:    T4 21, T1 12, T3 9, T2 7 -- nobody moves this week
    assert [rows[f"T{tid}"]["projected_rank"] for tid in (4, 1, 3, 2)] == [1, 2, 3, 4]


def test_a_big_week_moves_a_team_up_the_projected_rank():
    # T2 sits a point behind T3 and outscores the league, which is worth 4
    # ranking points against T3's 2: 10 + 4 passes 11 + 2. The pair of ranks is
    # what the page draws its arrow from, so one week has to be able to move it.
    boxes = four_team_boxes({1: 100.0, 2: 120.0, 3: 90.0, 4: 80.0}, played=False)
    standings = standings_state({1: 9.0, 2: 10.0, 3: 11.0, 4: 30.0}, weeks=3)
    wf = build_week_file(boxes, week=4, season=2026, standings=standings,
                         playoff_cutoff=2)

    rows = block_by_abbrev(wf)
    assert (rows["T2"]["current_rank"], rows["T2"]["projected_rank"]) == (3, 2)
    assert (rows["T3"]["current_rank"], rows["T3"]["projected_rank"]) == (2, 3)
    assert (rows["T4"]["current_rank"], rows["T4"]["projected_rank"]) == (1, 1)


def test_teams_level_entering_the_week_are_not_shown_moving_past_each_other():
    # T1 and T3 arrive level on 10. Whichever of them the week puts ahead, both
    # have to read as having held their place: neither passed the other, and an
    # arrow drawn off an order nobody earned is the Standings table's own
    # documented mistake to avoid (docs/js/charts.js, previousRanks).
    boxes = four_team_boxes({1: 90.0, 2: 120.0, 3: 100.0, 4: 80.0}, played=False)
    standings = {"teams": {tid: {"cumulative_points_by_week": [pts]}
                           for tid, pts in [(3, 10.0), (1, 10.0),
                                            (2, 1.0), (4, 30.0)]}}
    wf = build_week_file(boxes, week=2, season=2026, standings=standings,
                         playoff_cutoff=2)

    rows = block_by_abbrev(wf)
    # T3 out-earns T1 this week, so it ends ahead -- without being credited a
    # move it did not make.
    assert (rows["T3"]["current_rank"], rows["T3"]["projected_rank"]) == (2, 2)
    assert (rows["T1"]["current_rank"], rows["T1"]["projected_rank"]) == (3, 3)


def test_ties_below_still_let_a_real_mover_pass_them():
    # The tie rule must not swallow genuine movement. T2 enters last on 9, tops
    # the week for 4 ranking points, and passes the pair level on 10 -- who are
    # shown moving down, because this time somebody really did go by them.
    boxes = four_team_boxes({1: 80.0, 2: 120.0, 3: 90.0, 4: 110.0}, played=False)
    standings = {"teams": {tid: {"cumulative_points_by_week": [pts]}
                           for tid, pts in [(3, 10.0), (1, 10.0),
                                            (2, 9.0), (4, 30.0)]}}
    wf = build_week_file(boxes, week=2, season=2026, standings=standings,
                         playoff_cutoff=2)

    rows = block_by_abbrev(wf)
    assert (rows["T2"]["current_rank"], rows["T2"]["projected_rank"]) == (4, 2)
    assert (rows["T3"]["current_rank"], rows["T3"]["projected_rank"]) == (2, 3)
    assert (rows["T1"]["current_rank"], rows["T1"]["projected_rank"]) == (3, 4)


def test_on_a_final_week_the_block_is_the_weeks_actual_result():
    # The same league, once as an unfinished week and once as a settled one.
    # A final week's block is not a projection of anything: the totals are the
    # scores and the cumulative is where the standings actually land.
    totals = {1: 90.0, 2: 120.0, 3: 100.0, 4: 80.0}
    standings = standings_state({1: 10.0, 2: 3.0, 3: 6.0, 4: 20.0}, weeks=3)
    live = build_week_file(four_team_boxes(totals, played=False), week=4,
                           season=2026, standings=standings, playoff_cutoff=2)
    done = build_week_file(four_team_boxes(totals, played=True), week=4,
                           season=2026, standings=standings, playoff_cutoff=2)

    assert live["status"] == "upcoming"
    assert done["status"] == "final"
    assert done["projected_standings"] == live["projected_standings"]
    for row in done["projected_standings"]:
        assert row["projected_total"] == totals[row["team_id"]]


def test_a_final_week_is_measured_from_the_standings_before_it_not_after():
    # accumulate_weeks has already counted this final week, so the last slot
    # includes it. Reading that slot would hand out the week's ranking points
    # twice and leave every arrow pointing nowhere.
    totals = {1: 90.0, 2: 120.0, 3: 100.0, 4: 80.0}
    standings = {"teams": {
        # week 1 cumulative, then week 2's -- week 2 being the week being built
        1: {"cumulative_points_by_week": [10.0, 12.0]},
        2: {"cumulative_points_by_week": [3.0, 7.0]},
        3: {"cumulative_points_by_week": [6.0, 9.0]},
        4: {"cumulative_points_by_week": [20.0, 21.0]},
    }}
    wf = build_week_file(four_team_boxes(totals, played=True), week=2,
                         season=2026, standings=standings, playoff_cutoff=2)

    rows = block_by_abbrev(wf)
    assert rows["T2"]["projected_cumulative"] == 7.0     # 3 + 4, not 7 + 4
    assert rows["T1"]["projected_cumulative"] == 12.0


def test_week_one_starts_every_team_from_nothing():
    boxes = four_team_boxes({1: 90.0, 2: 120.0, 3: 100.0, 4: 80.0}, played=False)
    wf = build_week_file(boxes, week=1, season=2026, playoff_cutoff=2)

    rows = block_by_abbrev(wf)
    # Nothing has been earned yet, so the week's ranking points are the whole
    # cumulative and the projected rank is this week's order.
    assert rows["T2"]["projected_cumulative"] == 4.0
    assert [r["projected_rank"] for r in wf["projected_standings"]] == [1, 2, 3, 4]
    # And nobody has moved: every team entered level on nothing, so the page has
    # no arrow to draw. Handing out a baseline order by whatever sequence ESPN
    # listed the teams in would invent twelve of them on day one.
    for row in wf["projected_standings"]:
        assert row["current_rank"] == row["projected_rank"]


def test_a_playoff_week_has_no_projected_standings_block():
    boxes = four_team_boxes({1: 90.0, 2: 120.0, 3: 100.0, 4: 80.0}, played=False)
    wf = build_week_file(boxes, week=15, season=2026, is_playoff=True,
                         playoff_cutoff=2)

    assert "projected_standings" not in wf


def test_a_playoff_bye_is_left_out_of_a_regular_weeks_block():
    # A bye has no opponent side. Regular-season weeks never carry one, but the
    # block reads the same matchup list either way, so it has to skip the hole
    # rather than count a team that is not there.
    boxes = four_team_boxes({1: 90.0, 2: 120.0}, played=False)
    boxes.append(FakeBox(FakeTeam(3), 0.0, [FakePlayer(projected=50.0)],
                         None, 0.0, []))
    wf = build_week_file(boxes, week=1, season=2026, playoff_cutoff=2)

    assert [r["team_id"] for r in wf["projected_standings"]] == [2, 1, 3]


# --- season rollover ---------------------------------------------------------
# The site becomes the new season's site on kickoff week: the week the games
# are about to start, the standings file is written even with nothing final in
# it, so the week files can publish alongside and the Week 1 preview is visible
# before Week 1 is done.

LAST_SEASON = {"season": 2025, "completed_weeks": 14}
NOW = datetime(2026, 9, 9, 12, 0, tzinfo=timezone.utc)


def kicking_off_in(days):
    """A week whose only game starts `days` from NOW."""
    when = NOW + timedelta(days=days)
    return [box([FakePlayer(name="Home", game_date=when)],
                [FakePlayer(name="Away", game_date=when)])]


def test_a_week_whose_games_are_weeks_away_is_not_near_kickoff():
    # ESPN serves week-1 schedule rows and rosters as soon as the league year
    # exists. That is not kickoff, and it must not hand the site to an empty
    # season in August.
    assert not near_kickoff(kicking_off_in(20), NOW)


def test_a_week_whose_games_are_days_away_is_near_kickoff():
    assert near_kickoff(kicking_off_in(5), NOW)


def test_a_week_that_has_already_started_is_near_kickoff():
    assert near_kickoff(kicking_off_in(-2), NOW)


def test_a_week_espn_gives_no_kickoff_times_for_reads_as_far_off():
    boxes = [box([FakePlayer(name="Home")], [FakePlayer(name="Away")])]
    assert not near_kickoff(boxes, NOW)


def test_a_bench_players_kickoff_does_not_speak_for_the_week():
    boxes = [box([FakePlayer(name="Benched", slot="BE",
                             game_date=NOW + timedelta(days=1))],
                 [FakePlayer(name="Away", game_date=NOW + timedelta(days=30))])]
    assert not near_kickoff(boxes, NOW)


def test_the_schedule_alone_does_not_roll_the_season_over():
    assert not publishes_this_season(2026, 0,
                                     near_kickoff(kicking_off_in(20), NOW),
                                     LAST_SEASON)


def test_kickoff_week_rolls_the_season_over_with_nothing_final():
    assert publishes_this_season(2026, 0,
                                 near_kickoff(kicking_off_in(5), NOW),
                                 LAST_SEASON)


def test_the_rolled_over_season_starts_with_empty_arrays():
    boxes = kicking_off_in(-2)                       # week 1, under way
    boxes[0].home_lineup[0].game_played = 100
    wk = build_week(boxes, 1)
    standings = accumulate_weeks([wk], [1, 2], playoff_cutoff=1)

    assert standings["final_weeks"] == 0
    assert standings["top_players_by_week"] == []
    assert standings["position_scores_by_week"] == []
    for arrays in standings["teams"].values():
        assert arrays["scores_by_week"] == []
        assert arrays["cumulative_points_by_week"] == []
        assert arrays["normalized_by_week"] == []
    assert build_week_file(boxes, week=1, season=2026) is not None
    assert publishes_this_season(2026, standings["final_weeks"],
                                 near_kickoff(boxes, NOW), LAST_SEASON)


def test_a_preseason_run_that_found_nothing_keeps_the_previous_season():
    assert not publishes_this_season(2026, 0, False, LAST_SEASON)


def test_the_very_first_run_writes_a_standings_file_with_nothing_to_keep():
    assert publishes_this_season(2026, 0, False, None)


def test_a_final_week_rolls_the_season_over_whatever_the_kickoffs_say():
    # A week cannot be final without having been played, so a season with one
    # rolls over even if ESPN served no kickoff times to read.
    assert publishes_this_season(2026, 1, False, LAST_SEASON)


def test_a_second_run_during_week_one_still_publishes_the_empty_board():
    # The rollover already happened; the week file has to keep refreshing
    # daily, and rewriting an empty board over an empty board loses nothing.
    assert publishes_this_season(2026, 0, True,
                                 {"season": 2026, "completed_weeks": 0})


def test_a_gap_at_week_one_leaves_a_standing_season_alone():
    # Week 1's fetch failed and week 5's did not: accumulate_weeks stops before
    # the gap, so this run counts no final week at all. Publishing it would
    # replace five weeks of standings with empty arrays until tomorrow's run.
    assert not publishes_this_season(2026, 0, True,
                                     {"season": 2026, "completed_weeks": 5})


def test_a_gap_mid_season_does_not_republish_fewer_weeks_than_are_up():
    # Weeks 1, 2, 4 and 5 came back and week 3's fetch did not, so the
    # standings stop after week 2. The site is showing five.
    assert not publishes_this_season(2026, 2, True,
                                     {"season": 2026, "completed_weeks": 5})


def test_a_run_that_counts_the_weeks_already_up_republishes_them():
    # The ordinary nightly run: same weeks, fresher numbers.
    assert publishes_this_season(2026, 5, True,
                                 {"season": 2026, "completed_weeks": 5})


def test_a_week_going_final_publishes_over_the_week_before_it():
    assert publishes_this_season(2026, 6, True,
                                 {"season": 2026, "completed_weeks": 5})


def test_a_run_that_fetched_nothing_keeps_this_season_too():
    assert not publishes_this_season(2026, 0, False,
                                     {"season": 2026, "completed_weeks": 5})
