// One matchup in ESPN's FantasyCast shape: the two starting lineups paired
// slot by slot, with the advantage on the side of each row that is winning it.
// The standings file says which weeks exist and which team the visitor follows;
// the week file says who is playing whom and what every starter is worth.

// HIGHLIGHT_PARAM, teamKey and resolveHighlight come from highlight.js, which
// this page loads first: the team a bare visit opens on is the same choice the
// Standings page owns and the Scoreboard tints.
// The small helpers below are twins of the Scoreboard's. The site has no
// bundler -- every page is a script tag -- and a page's own script is the one
// place it is safe for another ticket to edit, so the two copies stay separate
// rather than sharing a file neither page owns.
const WEEK_PARAM = "week";

// ESPN's public image CDN, keyed by player id and by NFL team abbreviation.
const HEADSHOT_BASE = "https://a.espncdn.com/i/headshots/nfl/players/full/";
const TEAM_LOGO_BASE = "https://a.espncdn.com/i/teamlogos/nfl/500/";
// A Team QB is a whole team's quarterbacks and a D/ST is the defense: neither
// has a face, so both wear the NFL team's logo instead. The slot is what names
// a Team QB, because build_week_file writes its position as plain QB.
const TEAM_QB_SLOT = "TQB";
const DST_POSITION = "D/ST";

const SVG_NS = "http://www.w3.org/2000/svg";
// A head and shoulders, drawn rather than fetched: the fallback has to work at
// the moment a hotlinked headshot fails, which is no time to ask for a file.
const SILHOUETTE_PATH =
  "M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.4 0-8 2.7-8 6v2h16v-2c0-3.3-3.6-6-8-6z";

// Kickoffs are written as ISO 8601 UTC; this is the only place the site turns
// one into a wall clock, and it does it in whatever zone the viewer is in.
const KICKOFF_FMT = { weekday: "short", hour: "numeric", minute: "2-digit" };

async function loadJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

/** The weeks this page can open, oldest first, as the fetcher listed them. */
function weekList(meta) {
  return Array.isArray(meta.week_files) ? meta.week_files.slice() : [];
}

const pts = n => (Math.round((n || 0) * 10) / 10).toFixed(1);
const recordText = r =>
  !r ? "" : r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// ── Resolution: which week, and whose matchup ──

/**
 * The week to open: the one the link names if it was published, else the
 * current one, else the most recent week there is a file for. A link to a week
 * nobody wrote lands on a real week rather than on the empty state.
 */
function chooseWeek(meta, weeks) {
  const asked = Number(new URLSearchParams(location.search).get(WEEK_PARAM));
  if (weeks.includes(asked)) return asked;
  if (weeks.includes(meta.current_week)) return meta.current_week;
  return weeks[weeks.length - 1];
}

/**
 * The matchup to open: the highlighted team's, else the week's first one.
 * A team can be missing from a week it did not play -- a stale link, or a
 * playoff week it is not in -- and the first matchup is still worth showing.
 */
function chooseMatchup(weekFile, abbrev) {
  const matchups = weekFile.matchups || [];
  const named = abbrev && matchups.find(
    m => [m.home, m.away].some(s => s && s.abbrev === abbrev));
  return named || matchups[0] || null;
}

// ── The pieces of a row ──

function silhouette() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "player-shot player-silhouette");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", SILHOUETTE_PATH);
  svg.appendChild(path);
  return svg;
}

function headshotURL(player) {
  if (player.slot === TEAM_QB_SLOT || player.position === DST_POSITION) {
    return player.pro_team
      ? `${TEAM_LOGO_BASE}${player.pro_team.toLowerCase()}.png` : "";
  }
  return player.player_id ? `${HEADSHOT_BASE}${player.player_id}.png` : "";
}

/**
 * The player's picture, with the silhouette standing by. Headshots are
 * hotlinked, so a retired id, a rookie ESPN has no photo of, or a CDN having a
 * bad morning all end the same way: the row keeps its shape.
 */
function headshot(player) {
  const src = headshotURL(player);
  if (!src) return silhouette();
  const img = el("img", "player-shot");
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => img.replaceWith(silhouette()));
  return img;
}

/** Who the player faces and when, or the bye that says he faces nobody. */
function gameLine(player) {
  const game = el("span", "player-game");
  if (player.on_bye) {
    game.appendChild(el("span", "player-bye", "BYE"));
    return game;
  }
  if (player.opponent) {
    game.appendChild(el("span", "player-opp", player.opponent));
  }
  const kick = player.kickoff && new Date(player.kickoff);
  if (kick && !isNaN(kick)) {
    game.appendChild(el("span", "player-kick",
                        kick.toLocaleString(undefined, KICKOFF_FMT)));
  }
  return game;
}

/** The projection, always; the actual only once the game has been played. */
function pointsBox(player) {
  const box = el("div", "player-pts");
  const proj = el("span", "pts-proj", pts(player.projected));
  proj.setAttribute("aria-label", `Projected ${pts(player.projected)}`);
  box.appendChild(proj);
  if (player.played) {
    const actual = el("span", "pts-actual", pts(player.actual));
    actual.setAttribute("aria-label", `Scored ${pts(player.actual)}`);
    box.appendChild(actual);
  }
  return box;
}

/** One side of one row. An absent player leaves the side empty, not missing. */
function playerCell(player, side) {
  const cell = el("div", `slot-side ${side}`);
  if (!player) {
    cell.classList.add("empty");
    return cell;
  }
  const wrap = el("div", "player");
  wrap.appendChild(headshot(player));

  const id = el("div", "player-id");
  id.appendChild(el("span", "player-name", player.name));
  const meta = el("span", "player-meta");
  meta.appendChild(el("span", "player-team", player.pro_team));
  meta.appendChild(el("span", "player-pos", player.position));
  if (player.injury) meta.appendChild(el("span", "injury-tag", player.injury));
  id.appendChild(meta);
  id.appendChild(gameLine(player));
  wrap.appendChild(id);

  wrap.appendChild(pointsBox(player));
  cell.appendChild(wrap);
  return cell;
}

/**
 * Which side of a row is winning it: the higher projection, or the higher
 * actual once both games are over. Nobody is marked on a tie, on a bye, or
 * where one side has no player, because the mark would not mean anything.
 */
function advantageSide(home, away) {
  if (!home || !away) return "";
  if (home.on_bye || away.on_bye) return "";
  const settled = home.played && away.played;
  const h = settled ? home.actual : home.projected;
  const a = settled ? away.actual : away.projected;
  if (h === a) return "";
  return h > a ? "home" : "away";
}

function markAdvantage(cell) {
  cell.classList.add("advantage");
  const mark = el("span", "adv-mark", "▲");
  mark.appendChild(el("span", "sr-only", " advantage"));
  cell.appendChild(mark);
}

/**
 * Pair the two lineups by index and draw a row each. ESPN's own slot order is
 * what makes the pairing meaningful, so neither side is sorted here.
 * `compare` is off for the bench, which is not a matchup and has no advantage.
 */
function renderRows(holder, home, away, { compare }) {
  holder.innerHTML = "";
  const rows = Math.max(home.length, away.length);
  for (let i = 0; i < rows; i++) {
    const h = home[i] || null;
    const a = away[i] || null;
    const row = el("div", "lineup-row");
    row.dataset.slot = (h || a).slot;
    const homeCell = playerCell(h, "home");
    const awayCell = playerCell(a, "away");
    if (compare) {
      const winner = advantageSide(h, a);
      if (winner === "home") markAdvantage(homeCell);
      if (winner === "away") markAdvantage(awayCell);
    }
    row.appendChild(homeCell);
    row.appendChild(el("div", "slot-label", (h || a).slot));
    row.appendChild(awayCell);
    holder.appendChild(row);
  }
}

// ── The header ──

function teamHead(side, isFinal) {
  const head = el("div", "team-head");
  head.dataset.team = side.abbrev;
  if (side.logo_url) {
    const logo = el("img", "team-head-logo");
    logo.src = side.logo_url;
    logo.alt = "";
    // A team that never set a logo, or a URL ESPN has since retired, leaves a
    // broken-image glyph in the header. Dropping it is tidier than a
    // placeholder the header was not designed around.
    logo.addEventListener("error", () => logo.remove());
    head.appendChild(logo);
  }

  const id = el("div", "team-head-id");
  id.appendChild(el("span", "team-head-name", side.team_name));
  const meta = el("span", "team-head-meta");
  meta.appendChild(el("span", "team-head-mgr", side.owner || ""));
  meta.appendChild(el("span", "team-head-record", recordText(side.record)));
  id.appendChild(meta);
  const counts = el("span", "team-head-counts");
  counts.appendChild(el("span", "counts-played", String(side.played)));
  counts.appendChild(el("span", "counts-word", " played · "));
  counts.appendChild(el("span", "counts-to-play", String(side.to_play)));
  counts.appendChild(el("span", "counts-word", " to play"));
  id.appendChild(counts);
  head.appendChild(id);

  const score = el("div", "team-head-score");
  score.appendChild(el("span", "team-head-total",
                       pts(isFinal ? side.score : side.projected_total)));
  score.appendChild(el("span", "total-label", isFinal ? "Score" : "Projected"));
  head.appendChild(score);
  return head;
}

function renderHeader(matchup, isFinal) {
  const holder = document.getElementById("matchup-header");
  holder.innerHTML = "";
  for (const side of [matchup.home, matchup.away]) {
    if (side) holder.appendChild(teamHead(side, isFinal));
  }
}

// ── The page ──

function showEmpty(message) {
  document.getElementById("empty-message").textContent = message;
  document.getElementById("empty-state").classList.remove("hidden");
  document.getElementById("matchup-section").classList.add("hidden");
}

const STATUS_WORD = {
  final: "Final", "in-progress": "In progress", upcoming: "Projected",
};

function wireBench(holder) {
  const btn = document.getElementById("bench-toggle");
  btn.onclick = () => {
    const hidden = holder.classList.toggle("hidden");
    btn.textContent = hidden ? "Show bench" : "Hide bench";
    btn.setAttribute("aria-expanded", String(!hidden));
  };
}

async function main() {
  let data;
  try {
    data = await loadJSON("data/league_data.json");
  } catch (e) {
    showEmpty("Couldn't load league data yet.");
    return;
  }
  const meta = data.metadata || {};
  document.getElementById("updated").textContent =
    meta.updated_at ? `Updated ${meta.updated_at}` : "";

  const weeks = weekList(meta);
  if (!weeks.length) {
    showEmpty("No weeks have been published yet. Check back after kickoff.");
    return;
  }
  const week = chooseWeek(meta, weeks);

  let weekFile;
  try {
    weekFile = await loadJSON(`data/week_${week}.json`);
  } catch (e) {
    showEmpty(`Week ${week} hasn't been published yet.`);
    return;
  }

  const highlight = resolveHighlight((data.teams || []).map(teamKey));
  const matchup = chooseMatchup(weekFile, highlight);
  if (!matchup) {
    showEmpty(`Week ${week} has no matchups to show.`);
    return;
  }

  const isFinal = weekFile.status === "final";
  document.getElementById("subtitle").textContent =
    `Week ${weekFile.week}` + (weekFile.is_playoff ? " · Playoffs" : "") +
    ` · ${STATUS_WORD[weekFile.status] || "Projected"}`;
  const named = [matchup.home, matchup.away].filter(Boolean)
    .map(s => s.abbrev).join(" vs ");
  document.title = `${named} — Week ${weekFile.week} — Fantasy Football`;

  renderHeader(matchup, isFinal);
  const empty = [];
  renderRows(document.getElementById("lineup-rows"),
             matchup.home ? matchup.home.lineup || [] : empty,
             matchup.away ? matchup.away.lineup || [] : empty,
             { compare: true });
  const bench = document.getElementById("bench-rows");
  renderRows(bench,
             matchup.home ? matchup.home.bench || [] : empty,
             matchup.away ? matchup.away.bench || [] : empty,
             { compare: false });
  wireBench(bench);
  document.getElementById("matchup-section").classList.remove("hidden");
}

main();
