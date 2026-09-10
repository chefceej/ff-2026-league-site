# Fantasy Football League Site

A public static site for a private 12-team ESPN fantasy football league. Its
standings are built on weekly ranking points against the whole field rather than
on ESPN's head-to-head records.

## Language

### Standings

**Ranking points**:
The points a team earns in one week from where its score ranks against every
other team: best score gets 12, worst gets 1, ties share the average.
_Avoid_: rank points, weekly points, points (on its own)

**Score**:
A team's actual fantasy points in a week, as ESPN totals them.
_Avoid_: points, actual points

**Playoff cutoff**:
The standings rank (6th) that separates the playoff picture from the rest.
_Avoid_: bubble, the line

**Normalized points**:
A team's cumulative ranking points minus the cutoff team's, so the cutoff team
sits at 0 and positive means inside the playoff picture.
_Avoid_: norm, position, margin

### Lineups

**QB slot**:
The quarterback starting slot. In 2026 the league fills it with a Team QB
(an NFL team's quarterbacks as one unit); in 2025 it held an individual
quarterback. Both count as QB everywhere the site groups by position.
_Avoid_: TQB (as a separate position bucket), team quarterback

### Weeks and matchups

**Week**:
One matchup period, numbered the way ESPN numbers NFL weeks.
_Avoid_: round, scoring period

**Final week**:
A week in which every rostered starter has played or is on bye. Only final
weeks count toward standings.
_Avoid_: completed week, done week

**Upcoming week**:
A week in which no game has started yet.
_Avoid_: future week, next week

**In-progress week**:
A week in which at least one game has started and the week is not yet final.
_Avoid_: live week, partial week

**Scoring period**:
ESPN's own week number, which is not always the site's. A week is one matchup
period and usually spans one scoring period, but a league can run a playoff
round over two, and the NFL's scoring periods carry on past the league's last
week either way. ESPN is asked for a week by the scoring period it starts in.
_Avoid_: espn week, period (on its own)

**Regular-season week**:
A week up to and including the league's last regular-season week, where ranking
points are earned. Only these weeks feed the standings.
_Avoid_: normal week, season week

**Playoff week**:
A week past the last regular-season one, where ESPN runs the bracket. The
Scoreboard shows its matchups labeled as playoffs; it earns no ranking points,
so it never reaches the standings and carries no projected standings.
_Avoid_: bracket week, postseason week, playoff round

**Season rollover**:
The moment the site starts describing the new season instead of the last one:
the first run whose fetched week is at or near kickoff, which is kickoff week
rather than the Tuesday after. ESPN serves a new league year's schedule and
rosters weeks earlier, so an answer from ESPN is not the signal; a kickoff time
within a week of the run is. Before it, the site is in the **preseason** and
still shows the most recent completed season.
_Avoid_: season change, new year, cutover

**Matchup**:
ESPN's head-to-head pairing of two teams for one week.
_Avoid_: game, contest, H2H

**Scoreboard**:
The page listing every matchup for one week, with the week's projected
standings.
_Avoid_: matchups page, week page

**Preview**:
A matchup or week shown before it is final, built from projections.
_Avoid_: forecast, upcoming (as a name for a preview; an upcoming week is its
own term above)

**Box score**:
A matchup or week shown after it is final, built from actual scores.
_Avoid_: results, recap

**Side**:
One team's half of a matchup: the team plus what it did or is projected to do
that week. A playoff bye is a matchup with only one side.
_Avoid_: half, entry, participant

**Projected total**:
A team's expected score for a week: actual points for starters who have
played plus projected points for those who have not. A starter on bye counts
as nothing either way, so a final week's projected total is its score.
_Avoid_: proj, expected score, live projection
