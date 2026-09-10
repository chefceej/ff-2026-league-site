// Render one week's matchups from the week file the fetcher publishes.
// The standings file says which weeks exist and which one is current; the week
// file says what happened (or is projected) in the week on screen.

// HIGHLIGHT_PARAM, teamKey and resolveHighlight come from highlight.js, which
// this page loads first; the Standings page owns the choice and this one reads it.
const WEEK_PARAM = "week";

async function loadJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

/** The weeks this page can open, oldest first, as the fetcher listed them. */
function weekList(meta) {
  return Array.isArray(meta.week_files) ? meta.week_files.slice() : [];
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
 * The tint belongs to the whole card, not to a half of it, so nothing here
 * knows about the highlight.
 */
function renderSide(side, { isFinal, winner }) {
  const wrap = el("div", "matchup-side");
  wrap.dataset.team = side.abbrev;
  if (winner) wrap.classList.add("winner");

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
    // A playoff bye: the file gives the matchup one side, because there is no
    // opponent to give it a second one.
    const isBye = sides.length === 1;
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
    if (highlight && sides.some(s => s.abbrev === highlight)) {
      card.classList.add("highlight");
    }
    for (const side of sides) {
      card.appendChild(renderSide(side, {
        isFinal, winner: best != null && side.score === best,
      }));
    }
    // The half where the opponent would be. Filled with the word rather than
    // left blank, so a bye reads as a week the team sat out and not as a card
    // that failed to render.
    if (isBye) card.appendChild(el("div", "matchup-side bye-side", "Bye"));
    holder.appendChild(card);
  }
}

/**
 * The projected standings under the cards: every team in the file's order --
 * which is by projected total -- with the ranking points the week would earn
 * them, where their normalized points would land, and how far they would move.
 *
 * The heading is the honest part. An unfinished week's numbers are a
 * projection and say so; a final week's are the standings themselves.
 * `week` is the week on screen rather than the file's own number, so the
 * heading and the week label can never name different weeks.
 */
function renderProjectedStandings(weekFile, week) {
  const section = document.getElementById("projected-standings");
  const rows = weekFile.projected_standings;
  // A playoff week writes no block: the bracket hands out no ranking points.
  if (!Array.isArray(rows) || !rows.length) {
    section.classList.add("hidden");
    return;
  }
  document.getElementById("projected-heading").textContent =
    weekFile.status === "final"
      ? `Standings after Week ${week}`
      : `Projected standings after Week ${week}`;

  const tbody = document.querySelector("#projected-table tbody");
  tbody.innerHTML = "";
  for (const r of rows) {
    const norm = r.projected_normalized;
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="rk"><span class="rk-num">${r.projected_rank}</span>` +
        movementCell(r.current_rank - r.projected_rank) + `</td>` +
      `<td class="left team"></td>` +
      `<td class="proj">${pts(r.projected_total)}</td>` +
      `<td class="rp">${pts(r.projected_ranking_points)}</td>` +
      `<td class="norm ${norm >= 0 ? "pos" : "neg"}">${norm > 0 ? "+" : ""}${norm}</td>`;
    // Team names come from ESPN and are league members' own words, so they are
    // written as text rather than parsed as markup.
    tr.querySelector("td.team").textContent = r.team_name;
    tbody.appendChild(tr);
  }
  section.classList.remove("hidden");
}

function showEmpty(message) {
  document.getElementById("matchup-cards").innerHTML = "";
  document.getElementById("projected-standings").classList.add("hidden");
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
  const playoffTag = document.getElementById("week-playoff-label");
  const prevBtn = document.getElementById("prev-week-btn");
  const nextBtn = document.getElementById("next-week-btn");
  show("week-section");

  // Which render owns the DOM. The label and the arrows move the moment you
  // click; the cards can only arrive a round trip later. Two clicks inside one
  // round trip start two fetches, and without this the slower one would win --
  // painting one week's cards under another week's label, or reporting a week
  // that is published as missing because its neighbour's 404 landed last.
  let latestRender = 0;

  async function render() {
    const mine = ++latestRender;
    const week = weeks[index];
    label.textContent = `Week ${week}`;
    // Only the week file says whether the week is a playoff week, and that is
    // a round trip away -- so the tag comes off now and goes back on with the
    // cards. A week that turns out to be missing keeps it off.
    playoffTag.classList.add("hidden");
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === weeks.length - 1;
    try {
      const weekFile = await loadJSON(`data/week_${week}.json`);
      if (mine !== latestRender) return;
      hideEmpty();
      playoffTag.classList.toggle("hidden", !weekFile.is_playoff);
      renderCards(weekFile, highlight);
      renderProjectedStandings(weekFile, week);
    } catch (e) {
      if (mine !== latestRender) return;
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
