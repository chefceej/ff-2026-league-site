"""Tests for the pure per-week transform.

Stand-ins mimic the espn_api box-score objects the fetcher actually sees:
a BoxScore with home/away team, score and lineup, and BoxPlayers carrying
slot_position, position, points, game_played (0-100) and on_bye_week.
"""
from datetime import datetime, timedelta, timezone

import pytest

from week_data import (accumulate_weeks, assign_ranking_points,
                       build_week, build_week_file, week_status,
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
                 wins=0, losses=0, ties=0, logo_url=""):
        self.team_id = team_id
        self.team_name = name or f"Team {team_id}"
        self.team_abbrev = abbrev or f"T{team_id}"
        self.owners = owners if owners is not None else []
        self.wins = wins
        self.losses = losses
        self.ties = ties
        self.logo_url = logo_url


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
