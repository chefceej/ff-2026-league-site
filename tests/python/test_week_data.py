"""Tests for the pure per-week transform.

Stand-ins mimic the espn_api box-score objects the fetcher actually sees:
a BoxScore with home/away team, score and lineup, and BoxPlayers carrying
slot_position, position, points, game_played (0-100) and on_bye_week.
"""
from week_data import (accumulate_weeks, assign_ranking_points,
                       build_week, week_status)


class FakePlayer:
    def __init__(self, name="Player", slot="QB", position="QB", points=0.0,
                 game_played=0, on_bye_week=False, pro_team="NE"):
        self.name = name
        self.slot_position = slot
        self.position = position
        self.points = points
        self.game_played = game_played
        self.on_bye_week = on_bye_week
        self.proTeam = pro_team


class FakeTeam:
    def __init__(self, team_id, name=None, abbrev=None):
        self.team_id = team_id
        self.team_name = name or f"Team {team_id}"
        self.team_abbrev = abbrev or f"T{team_id}"


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
    wk = build_week(boxes)
    assert wk["status"] == "final"
    assert wk["scores"] == {1: 20.0, 2: 11.5}


def test_build_week_buckets_starter_points_by_position_per_team():
    boxes = [box([FakePlayer(name="Passer", slot="QB", points=20.0),
                  FakePlayer(name="Runner", slot="RB", points=8.0),
                  FakePlayer(name="Flexed", slot="RB/WR/TE", points=5.0),
                  FakePlayer(name="Benched", slot="BE", points=99.0)],
                 [FakePlayer(name="Other passer", slot="QB", points=13.0)])]
    wk = build_week(boxes)
    assert wk["position_scores"]["T1"] == {"QB": 20.0, "RB": 8.0, "FLEX": 5.0}
    assert wk["position_scores"]["T2"] == {"QB": 13.0}


def test_build_week_ranks_starters_into_all_and_position_tabs():
    boxes = [box([FakePlayer(name="Passer", slot="QB", position="QB", points=20.0),
                  FakePlayer(name="Runner", slot="RB", position="RB", points=8.0)],
                 [FakePlayer(name="Other passer", slot="QB", position="QB",
                             points=13.0)])]
    wk = build_week(boxes)
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
    wk = build_week(boxes)
    assert wk["position_scores"]["T1"] == {"QB": 24.5}


def test_team_qb_players_appear_in_the_qb_top_scorers_tab():
    boxes = [box([FakePlayer(name="Chiefs QB", slot="TQB", position="TQB",
                             points=24.5, pro_team="KC")],
                 [FakePlayer(name="Passer", slot="QB", position="QB",
                             points=13.0)])]
    wk = build_week(boxes)
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


def week(status, scores):
    return {"status": status, "scores": scores,
            "top_players": {"all": []}, "position_scores": {}}


def test_an_in_progress_week_is_absent_from_the_standings_arrays():
    weeks = [week("final", {1: 100.0, 2: 90.0}),
             week("in-progress", {1: 40.0, 2: 10.0})]
    standings = accumulate_weeks(weeks, team_ids=[1, 2], num_teams=2,
                                 playoff_cutoff=1)
    assert standings["final_weeks"] == 1
    assert standings["teams"][1]["scores_by_week"] == [100.0]
    assert standings["teams"][1]["ranking_points_by_week"] == [2]
    assert standings["teams"][2]["scores_by_week"] == [90.0]


def test_upcoming_and_in_progress_weeks_contribute_no_top_scorers_or_positions():
    final = week("final", {1: 100.0, 2: 90.0})
    final["top_players"] = {"all": [{"name": "Passer"}]}
    final["position_scores"] = {"T1": {"QB": 20.0}}
    live = week("in-progress", {1: 40.0, 2: 10.0})
    live["top_players"] = {"all": [{"name": "Half a game"}]}
    live["position_scores"] = {"T1": {"QB": 8.0}}
    standings = accumulate_weeks([final, live], team_ids=[1, 2], num_teams=2,
                                 playoff_cutoff=1)
    assert standings["top_players_by_week"] == [{"all": [{"name": "Passer"}]}]
    assert standings["position_scores_by_week"] == [{"T1": {"QB": 20.0}}]


def test_cumulative_points_are_normalized_against_the_cutoff_team():
    weeks = [week("final", {1: 100.0, 2: 90.0, 3: 80.0}),
             week("final", {1: 100.0, 2: 95.0, 3: 99.0})]
    standings = accumulate_weeks(weeks, team_ids=[1, 2, 3], num_teams=3,
                                 playoff_cutoff=2)
    # Cumulative after two weeks: team 1 = 6, team 3 = 3, team 2 = 3.
    assert standings["teams"][1]["cumulative_points_by_week"] == [3, 6]
    assert standings["teams"][2]["cumulative_points_by_week"] == [2, 3]
    # 2nd-best cumulative is 3 both weeks, so it sits at 0 and the leader above.
    assert standings["teams"][1]["normalized_by_week"] == [1, 3]
    assert standings["teams"][2]["normalized_by_week"] == [0, 0]
