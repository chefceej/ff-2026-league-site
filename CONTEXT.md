# Fantasy Football League Site

A public static site for a private 12-team ESPN fantasy football league. Its
standings are built on weekly ranking points against the whole field rather than
on ESPN's head-to-head records.

## Language

### Managers and teams

**Manager**:
The person who runs a team. The site's identity across seasons: team names,
abbreviations, and logos change yearly, the manager doesn't.
_Avoid_: owner (ESPN's word, kept only in the data files), user, member

**Manager key**:
The slug that names a manager in links and data files, derived from their name
and never from ESPN's member id.
_Avoid_: manager id, owner id, slug (on its own)

**Team**:
One manager's entry in one season: its name, abbreviation, logo, and results. A
team may have more than one manager.
_Avoid_: franchise, squad

**Abbreviation**:
ESPN's short team code, which a manager can change at any time. In-season pages
key on it; it never identifies a manager.
_Avoid_: abbrev (in prose), team code

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

**Roster**:
Everyone on a team in one week: the lineup, the bench, and IR.
_Avoid_: squad, players, team (for the people on it)

**Lineup**:
The starters a team has set for one week, one per slot; only they score.
_Avoid_: starters (as the name), starting lineup, active roster

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

**Counted week**:
A final regular-season week the standings include: weeks are counted in order
from week one and stop at the first week that is not final. Every season stat
on the site runs over counted weeks and nothing else.
_Avoid_: eligible week, scored week, completed week, standings week

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

**Team page**:
The page for one team's season, keyed by its manager: standing, trajectory,
week by week, roster, and analytics.
_Avoid_: manager page, profile, My Team (that is the nav link, not the page)

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

### Analytics

**Best lineup**:
The legal lineup that would have scored most from a team's roster in one week,
by actual points under the slot rules, with IR players left out. Bye and injured
players score nothing, so they never displace anyone.
_Avoid_: optimal lineup, perfect lineup, max lineup

**Left on the bench**:
The points a team's best lineup would have scored beyond what its started lineup
did in one week, and their total over the counted weeks. Never below zero.
_Avoid_: bench regret, bench points, lineup gap

**Best swap**:
The single one-for-one exchange, a bench player into a starter's slot that
player is eligible for, that would have gained the most points in one week. It
can fall short of what was left on the bench when the best lineup takes more
than one move.
_Avoid_: biggest miss, should-have-started

**Expected wins**:
The wins a team would hold if it had played every other team each week: the
share of the field its score beat, summed over the counted weeks, a tie counting
half. Teams beaten in a week is ranking points minus one, so this is the
standings restated in wins.
_Avoid_: all-play wins, power wins, Pythagorean wins

**Luck**:
A team's actual wins over the counted weeks minus its expected wins; positive
means its record is better than its scores earned. Wins are counted from the
same weeks, a tie as half.
_Avoid_: schedule luck, variance, fortune

**Lucky win**:
A matchup won with a score in the bottom half of that week's field, beating at
most five teams.
_Avoid_: steal, robbery

**Unlucky loss**:
A matchup lost with a score in the top half of that week's field, beating at
least six teams. A tie that straddles the middle of the field is neither lucky
nor unlucky.
_Avoid_: bad beat

**Consistency**:
How steady a team's weekly scores are: the standard deviation of its scores
over the counted weeks, shown with its lowest, highest, and average score, and
ranked league-wide with 1 the steadiest. It exists from the first counted week,
however little one week says.
_Avoid_: volatility, variance, steadiness, boom-or-bust

**Lineup projection**:
The sum of a started lineup's per-player projections as the site last fetched
them before kickoff, which is what the manager saw when locking the lineup.
Unlike the projected total it never blends in actual points, so it stays the
pre-game number after the week is final.
_Avoid_: pre-game projection, ESPN projection, projected total (for this)

**Projection gap**:
A week's score minus its lineup projection, positive when the lineup beat its
projection, with the total and the per-week average over the counted weeks.
_Avoid_: projection error, projection accuracy (as the number's name), vs
projection, over/under

**Head-to-head record**:
A team's wins, losses, and ties against one opponent over the counted weeks.
_Avoid_: H2H, split, series record, season series
