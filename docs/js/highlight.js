// Which team the visitor follows, shared by every page that marks it.
// The Standings page owns the choice; the Scoreboard reads it so your matchup
// is tinted the same way your Standings row is. One copy, because two would
// drift and a drifted key silently forgets the team.

// One key, one query parameter, both holding a team abbreviation.
const HIGHLIGHT_KEY = "ff-highlight-team", HIGHLIGHT_PARAM = "team";

// The abbreviation a team is keyed by. The fetch script defaults team_abbrev to
// the empty string (src/fetch_data.py) and this feature already spends "" as its
// "no highlight" token, so an unfallen-back key would name None and light a team
// nobody chose. Falling back to the name is what the fetch script's own position
// bucketing and renderTable already do.
const teamKey = t => t.team_abbrev || t.team_name;

// Local storage is unavailable in some privacy modes, where merely touching it
// throws. The highlight is a convenience: losing it must never take down the
// page around it.
function readRemembered() {
  try { return localStorage.getItem(HIGHLIGHT_KEY); } catch (e) { return null; }
}
function writeRemembered(abbrev) {
  try {
    if (abbrev) localStorage.setItem(HIGHLIGHT_KEY, abbrev);
    else localStorage.removeItem(HIGHLIGHT_KEY);
  } catch (e) { /* the link still carries the choice; only the memory is lost */ }
}

/**
 * The abbreviation to highlight on load: the link's team if it names one we
 * know, else the remembered one if it does, else nothing. An unknown value is
 * ignored rather than corrected, and load never writes back — neither a stale
 * link nor someone else's shared one may overwrite what this device remembers.
 */
function resolveHighlight(abbrevs) {
  const known = a => (abbrevs.includes(a) ? a : "");
  const linked = new URLSearchParams(location.search).get(HIGHLIGHT_PARAM);
  return known(linked) || known(readRemembered());
}
