// Render one week's matchups from the week file the fetcher publishes.
// The standings file says which weeks exist and which one is current; the week
// file says what happened (or is projected) in the week on screen.

// One key, one query parameter, both holding a team abbreviation. Kept in step
// with charts.js: the Standings page owns the choice, and this page reads it so
// your matchup is tinted the same way your Standings row is.
const HIGHLIGHT_KEY = "ff-highlight-team", HIGHLIGHT_PARAM = "team";
const WEEK_PARAM = "week";

async function loadJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

// Local storage is unavailable in some privacy modes, where merely touching it
// throws. The highlight is a convenience; losing it must not take the page down.
function readRemembered() {
  try { return localStorage.getItem(HIGHLIGHT_KEY); } catch (e) { return null; }
}

/**
 * The abbreviation to tint: the link's team if it names one we know, else the
 * remembered one if it does, else nothing. Mirrors the Standings page, and like
 * it never writes back — a stale or shared link may not overwrite this device.
 */
function resolveHighlight(abbrevs) {
  const known = a => (abbrevs.includes(a) ? a : "");
  const linked = new URLSearchParams(location.search).get(HIGHLIGHT_PARAM);
  return known(linked) || known(readRemembered());
}

const teamKey = t => t.team_abbrev || t.team_name;

/** The weeks this page can open, oldest first. */
function weekList(meta) {
  const listed = meta.week_files;
  if (Array.isArray(listed) && listed.length) return listed.slice();
  const current = meta.current_week || 0;
  return Array.from({ length: current }, (_, i) => i + 1);
}

const pts = n => (Math.round(n * 10) / 10).toFixed(1);
const recordText = r =>
  !r ? "" : r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * One team's half of a card. `isFinal` decides whether the big number is a
 * projection or the score it settled at, and `winner` marks the box score.
 */
function renderSide(side, { isFinal, winner, highlighted }) {
  const wrap = el("div", "matchup-side");
  wrap.dataset.team = side.abbrev;
  if (winner) wrap.classList.add("winner");
  if (highlighted) wrap.classList.add("highlight-side");

  const main = el("div", "side-main");
  if (side.logo_url) {
    const logo = el("img", "side-logo");
    logo.src = side.logo_url;
    logo.alt = "";
    // A team that never set a logo, or a URL ESPN has since retired, leaves a
    // broken-image glyph in the middle of the card. Dropping it is tidier than
    // a placeholder the card was not designed around.
    logo.addEventListener("error", () => logo.remove());
    main.appendChild(logo);
  }
  const id = el("div", "side-id");
  id.appendChild(el("span", "side-name", side.team_name));
  const meta = el("span", "side-meta");
  meta.appendChild(el("span", "side-mgr", side.owner || ""));
  meta.appendChild(el("span", "side-record", recordText(side.record)));
  id.appendChild(meta);
  main.appendChild(id);

  main.appendChild(el("div", "side-total",
                      pts(isFinal ? side.score : side.projected_total)));
  if (winner) {
    // Announced as well as drawn, so the badge is never the only signal -- and
    // kept out of the total, which stays a number and nothing else.
    const mark = el("span", "winner-mark", "W");
    mark.appendChild(el("span", "sr-only", " winner"));
    main.appendChild(mark);
  }
  wrap.appendChild(main);

  const leaders = el("ul", "side-leaders");
  for (const p of side.leaders || []) {
    const li = el("li", "leader");
    li.appendChild(el("span", "leader-name", p.name));
    li.appendChild(el("span", "leader-pts",
                      pts(p.played ? p.actual : p.projected)));
    leaders.appendChild(li);
  }
  wrap.appendChild(leaders);
  return wrap;
}

function renderCards(weekFile, highlight) {
  const holder = document.getElementById("matchup-cards");
  holder.innerHTML = "";
  const isFinal = weekFile.status === "final";
  for (const m of weekFile.matchups || []) {
    const sides = [m.home, m.away].filter(Boolean);
    // A card is one link, so the whole matchup is the click target. It opens on
    // the home team; the matchup page resolves the rest from the week and team.
    const card = el("a", "matchup-card");
    card.href = `matchup.html?${WEEK_PARAM}=${weekFile.week}` +
                `&${HIGHLIGHT_PARAM}=${encodeURIComponent(sides[0].abbrev)}`;
    card.appendChild(el("div", "card-status", isFinal ? "Final" : "Projected"));
    // A tie has no winner, so nothing is marked rather than both.
    const best = isFinal && sides.length > 1 &&
                 sides[0].score !== sides[1].score
      ? Math.max(...sides.map(s => s.score)) : null;
    let tinted = false;
    for (const side of sides) {
      const highlighted = !!highlight && side.abbrev === highlight;
      tinted = tinted || highlighted;
      card.appendChild(renderSide(side, {
        isFinal, winner: best != null && side.score === best, highlighted,
      }));
    }
    if (tinted) card.classList.add("highlight");
    holder.appendChild(card);
  }
}

function showEmpty(message) {
  document.getElementById("matchup-cards").innerHTML = "";
  document.getElementById("empty-message").textContent = message;
  document.getElementById("empty-state").classList.remove("hidden");
}
function hideEmpty() {
  document.getElementById("empty-state").classList.add("hidden");
}
function show(id) { document.getElementById(id).classList.remove("hidden"); }

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
  const highlight = resolveHighlight((data.teams || []).map(teamKey));

  // Open on the current week when it is one of the weeks we have, else on the
  // most recent one, so the page never starts on a week nobody wrote.
  let index = weeks.indexOf(meta.current_week);
  if (index < 0) index = weeks.length - 1;

  const label = document.getElementById("week-nav-label");
  const prevBtn = document.getElementById("prev-week-btn");
  const nextBtn = document.getElementById("next-week-btn");
  show("week-section");

  async function render() {
    const week = weeks[index];
    label.textContent = `Week ${week}`;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === weeks.length - 1;
    try {
      const weekFile = await loadJSON(`data/week_${week}.json`);
      hideEmpty();
      renderCards(weekFile, highlight);
    } catch (e) {
      showEmpty(`Week ${week} hasn't been published yet.`);
    }
  }
  prevBtn.onclick = () => { if (index > 0) { index--; render(); } };
  nextBtn.onclick = () => {
    if (index < weeks.length - 1) { index++; render(); }
  };
  await render();
}

main();
