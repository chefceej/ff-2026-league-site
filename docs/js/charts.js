// Render the league standings + playoff-position chart from league_data.json.
// Medium-dark, distinct hues that read cleanly on a cream background.
const PALETTE = [
  "#2f7d4f", "#2b5c8a", "#b0402f", "#d1791f", "#1f8a86", "#7a4fa3",
  "#b8892b", "#566270", "#a8324a", "#6b7a2f", "#8a5a3c", "#a0498f",
];
const AXIS = "#7c7862", GRID = "#e6dcc4", LEG = "#20302a";
// Zero is the playoff cutoff, so its gridline is drawn in the same gold chalk
// as the Standings table's cutoff stripe. Keep in step with --gold in styles.css.
const CUTOFF = "#c8a23c", CUTOFF_WIDTH = 2;
// Highlight: the chosen line is drawn heavier with bigger points; the rest keep
// their hue at an alpha low enough to recede but still legible on the cream.
const DIM_ALPHA = 0.22;
const BASE_WIDTH = 2, BASE_POINT = 2;
const LIT_WIDTH = 3.5, LIT_POINT = 4;
// One key, one query parameter, both holding a team abbreviation.
const HIGHLIGHT_KEY = "ff-highlight-team", HIGHLIGHT_PARAM = "team";

// Chart.js resolves grid color and width per tick, so the cutoff line needs no
// plugin. Tick values are rounded to the step's precision, so zero is exact.
// (4.4.1 offers no per-gridline dash — the dash lives on the axis border — so
// the stripe is matched by color and weight alone.)
const atCutoff = ctx => ctx.tick && ctx.tick.value === 0;

async function main() {
  let data;
  try {
    const res = await fetch("data/league_data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (e) {
    showEmpty("Couldn't load league data yet.");
    return;
  }

  const meta = data.metadata || {};
  const teams = data.teams || [];
  document.getElementById("updated").textContent =
    meta.updated_at ? `Updated ${meta.updated_at}` : "";

  if (!meta.completed_weeks || teams.length === 0) {
    showEmpty();
    return;
  }

  // The season leads the subtitle: in the preseason the site still serves last
  // season's data, and that is the first thing a visitor needs to know.
  const season = meta.season ? `${meta.season} season · ` : "";
  document.getElementById("subtitle").textContent =
    `${season}${meta.num_teams}-team league · normalized so #${meta.playoff_cutoff} = 0 ` +
    `· ${meta.completed_weeks} week${meta.completed_weeks > 1 ? "s" : ""} played`;

  show("chart-section");
  show("table-section");
  const chart = renderChart(teams, meta);
  renderTable(teams, meta);
  setupHighlight(chart, teams);

  const cmw = meta.current_matchup_week || meta.completed_weeks;
  if (data.top_players_by_week?.length) {
    show("topscorers-section");
    buildTopScorersTable(data.top_players_by_week, cmw);
  }
  show("ranking-section");
  buildWeeklyTable(
    document.getElementById("ranking-points-head"),
    document.getElementById("ranking-points-body"),
    teams, cmw, "ranking_points_by_week", heatGreen);
  show("actual-section");
  buildWeeklyTable(
    document.getElementById("actual-points-head"),
    document.getElementById("actual-points-body"),
    teams, cmw, "scores_by_week", heatGreen, null, { perColumn: true });
}

// Cream-friendly heat map: pale green (low) -> deep field green (high).
function heatGreen(val, min, max) {
  const t = max === min ? 0.5 : (val - min) / (max - min);
  const L = 95 - t * 33;   // 95% -> 62% lightness
  const S = 30 + t * 32;   // 30% -> 62% saturation
  return `hsl(132, ${S}%, ${L}%)`;
}

// ── Top Scorers by Week (prev/next nav + position tabs) ──
function buildTopScorersTable(weeklyData, currentWeek) {
  let displayWeek = currentWeek - 1;
  let activeTab = "all";
  const label = document.getElementById("week-nav-label");
  const tbody = document.getElementById("top-scorers-body");
  const prevBtn = document.getElementById("prev-week-btn");
  const nextBtn = document.getElementById("next-week-btn");
  const tabsEl = document.getElementById("top-scorers-tabs");

  function players() {
    const wk = weeklyData[displayWeek];
    if (!wk) return [];
    return Array.isArray(wk) ? (activeTab === "all" ? wk : []) : (wk[activeTab] || []);
  }
  function render() {
    label.textContent = `Week ${displayWeek + 1} of ${currentWeek}`;
    prevBtn.disabled = displayWeek === 0;
    nextBtn.disabled = displayWeek === currentWeek - 1;
    const ps = players();
    tbody.innerHTML = "";
    if (!ps.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="nodata">No data</td></tr>`;
      return;
    }
    ps.forEach((p, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td class="rk">${i + 1}</td><td class="left player">${p.name}</td>` +
        `<td class="mut">${p.pro_team}</td><td class="left">${p.fantasy_team}</td>` +
        `<td class="pts">${p.score.toFixed(1)}</td>`;
      tbody.appendChild(tr);
    });
  }
  prevBtn.onclick = () => { if (displayWeek > 0) { displayWeek--; render(); } };
  nextBtn.onclick = () => { if (displayWeek < currentWeek - 1) { displayWeek++; render(); } };
  tabsEl.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", () => {
    tabsEl.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeTab = btn.dataset.tab;
    render();
  }));
  render();
}

// ── Weekly heat-map table with click-to-sort columns ──
function buildWeeklyTable(headEl, bodyEl, teams, currentWeek, key, colorFn, formatFn, opts) {
  const fmt = formatFn || (v => v.toFixed(1));
  const perColumn = opts?.perColumn || false;
  const weekMin = {}, weekMax = {};
  let gMin = Infinity, gMax = -Infinity;
  for (let w = 1; w <= currentWeek; w++) {
    let lo = Infinity, hi = -Infinity;
    teams.forEach(t => { const v = t[key][w - 1]; if (v != null) {
      lo = Math.min(lo, v); hi = Math.max(hi, v); gMin = Math.min(gMin, v); gMax = Math.max(gMax, v);
    }});
    weekMin[w] = lo; weekMax[w] = hi;
  }
  const total = t => t[key].slice(0, currentWeek).reduce((s, v) => s + (v ?? 0), 0);
  let sortWeek = "total", sortDir = -1;

  const headerRow = document.createElement("tr");
  const th0 = document.createElement("th"); th0.textContent = "Team"; th0.className = "sticky-col";
  headerRow.appendChild(th0);
  for (let w = 1; w <= currentWeek; w++) {
    const th = document.createElement("th"); th.textContent = `Wk ${w}`; th.dataset.week = w;
    headerRow.appendChild(th);
  }
  const tht = document.createElement("th"); tht.textContent = "Total"; tht.dataset.week = "total";
  tht.className = "total-col"; headerRow.appendChild(tht);
  headEl.innerHTML = ""; headEl.appendChild(headerRow);

  function indicators() {
    headEl.querySelectorAll("th[data-week]").forEach(th => {
      const w = th.dataset.week === "total" ? "total" : parseInt(th.dataset.week);
      const base = th.dataset.week === "total" ? "Total" : `Wk ${th.dataset.week}`;
      th.textContent = w === sortWeek ? `${base} ${sortDir === -1 ? "▼" : "▲"}` : base;
    });
  }
  function render() {
    indicators();
    const sorted = [...teams].sort((a, b) => {
      const av = sortWeek === "total" ? total(a) : (a[key][sortWeek - 1] ?? -Infinity);
      const bv = sortWeek === "total" ? total(b) : (b[key][sortWeek - 1] ?? -Infinity);
      return sortDir === -1 ? bv - av : av - bv;
    });
    bodyEl.innerHTML = "";
    sorted.forEach(team => {
      const tr = document.createElement("tr");
      const nm = document.createElement("td");
      nm.textContent = team.team_abbrev || team.team_name; nm.className = "sticky-col";
      tr.appendChild(nm);
      for (let w = 1; w <= currentWeek; w++) {
        const v = team[key][w - 1]; const td = document.createElement("td");
        if (v != null) {
          td.textContent = fmt(v);
          td.style.background = colorFn(v, perColumn ? weekMin[w] : gMin, perColumn ? weekMax[w] : gMax);
        } else td.textContent = "—";
        tr.appendChild(td);
      }
      const tt = document.createElement("td"); tt.textContent = fmt(total(team));
      tt.className = "total-col"; tr.appendChild(tt);
      bodyEl.appendChild(tr);
    });
  }
  headEl.querySelectorAll("th[data-week]").forEach(th => th.addEventListener("click", () => {
    const w = th.dataset.week === "total" ? "total" : parseInt(th.dataset.week);
    if (sortWeek === w) sortDir *= -1; else { sortWeek = w; sortDir = -1; }
    render();
  }));
  render();
}

function showEmpty(msg) {
  show("empty-state");
  if (msg) document.querySelector("#empty-state .empty-card p").textContent = msg;
}
function show(id) { document.getElementById(id).classList.remove("hidden"); }

function renderChart(teams, meta) {
  const weeks = meta.completed_weeks;
  const labels = Array.from({ length: weeks }, (_, i) => `W${i + 1}`);
  // backgroundColor is the legend swatch's fill and is deliberately left at full
  // strength: the highlight dims lines, not the legend. Everything else is the
  // highlight's to own, so it comes from the one styling routine, unhighlighted.
  const datasets = teams.map((t, i) => {
    const ds = {
      label: t.team_name,
      data: t.normalized_by_week,
      backgroundColor: PALETTE[i % PALETTE.length],
      tension: 0.25,
    };
    styleDataset(ds, i, NONE);
    return ds;
  });
  // The instance is returned, not discarded: the highlight routine restyles
  // these datasets in place, which is what keeps the legend's hidden state.
  return new Chart(document.getElementById("positionChart"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { labels: { color: LEG, boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y > 0 ? "+" : ""}${c.parsed.y}` } },
      },
      scales: {
        x: { ticks: { color: AXIS }, grid: { color: GRID } },
        y: {
          ticks: { color: AXIS },
          grid: {
            color: ctx => (atCutoff(ctx) ? CUTOFF : GRID),
            lineWidth: ctx => (atCutoff(ctx) ? CUTOFF_WIDTH : 1),
          },
          title: { display: true, text: "Points vs. playoff cutoff", color: AXIS },
        },
      },
    },
  });
}

// ── Highlight one team across the chart and the Standings table ──

/** No team highlighted: the index that matches no dataset and no table row. */
const NONE = -1;

/** A palette hex at `alpha`, so a faded line keeps its team's hue. */
function fade(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Style line `i` for a highlight on dataset `lit` (NONE for no highlight).
 * The single source of truth for a line's look: renderChart builds every
 * dataset through it, and the highlight routine rewrites them through it.
 */
function styleDataset(ds, i, lit) {
  const hue = PALETTE[i % PALETTE.length];
  const dimmed = lit !== NONE && i !== lit;
  ds.borderColor = ds.pointBackgroundColor = ds.pointBorderColor =
    dimmed ? fade(hue, DIM_ALPHA) : hue;
  ds.borderWidth = i === lit ? LIT_WIDTH : BASE_WIDTH;
  ds.pointRadius = i === lit ? LIT_POINT : BASE_POINT;
  // A point strokes over its own fill, so a faded one would otherwise read at
  // roughly twice its line's alpha and pull the eye off the chosen team.
  ds.pointBorderWidth = dimmed ? 0 : 1;
}

// Local storage is unavailable in some privacy modes, where merely touching it
// throws. The highlight is a convenience: losing it must never take down the
// sections main() renders after this one.
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

/** Record the choice on this device and in the link, without navigating. */
function rememberHighlight(abbrev) {
  const url = new URL(location.href);
  if (abbrev) url.searchParams.set(HIGHLIGHT_PARAM, abbrev);
  else url.searchParams.delete(HIGHLIGHT_PARAM);
  history.replaceState(null, "", url);
  writeRemembered(abbrev);
}

// The abbreviation a team is keyed by. The fetch script defaults team_abbrev to
// the empty string (src/fetch_data.py) and this feature already spends "" as its
// "no highlight" token, so an unfallen-back key would name None and light a team
// nobody chose. Falling back to the name is what the fetch script's own position
// bucketing and renderTable already do.
const teamKey = t => t.team_abbrev || t.team_name;

function setupHighlight(chart, teams) {
  // Datasets and Standings rows are both built from the delivered team order,
  // so one index addresses a team's line and its row alike.
  const abbrevs = teams.map(teamKey);
  const select = document.getElementById("highlight-team");
  const rows = document.querySelectorAll("#standings-table tbody tr");

  teams.forEach(t => {
    const option = document.createElement("option");
    option.value = teamKey(t);
    option.textContent = t.team_name;
    select.appendChild(option);
  });

  /**
   * Draw `abbrev` as the foreground of both views, or clear the highlight when
   * it is empty. `persist` is false on load, where the state came from storage
   * or the URL and writing it back would only echo.
   */
  function apply(abbrev, persist) {
    // teamKey guarantees no team is keyed by "", so the empty selection finds
    // nothing and lands on NONE by itself.
    const lit = abbrevs.indexOf(abbrev);
    select.value = abbrev;
    chart.data.datasets.forEach((ds, i) => styleDataset(ds, i, lit));
    // "none" skips the animation and, with it, any chance of a half-drawn
    // frame; dataset visibility lives in the chart's metadata either way.
    chart.update("none");
    rows.forEach((tr, i) => tr.classList.toggle("highlight", i === lit));
    if (persist) rememberHighlight(abbrev);
  }

  select.addEventListener("change", () => apply(select.value, true));
  apply(resolveHighlight(abbrevs), false);
}

// Where each team stood after the previous completed week: its 1-based position
// in a stable descending sort of cumulative points over the delivered order, so
// a tie at week N-1 resolves in current order and manufactures no movement.
function previousRanks(teams, completedWeeks) {
  if (completedWeeks < 2) return teams.map((_, i) => i + 1);
  const prev = [];
  teams
    .map((t, i) => ({ i, pts: t.cumulative_points_by_week[completedWeeks - 2] ?? 0 }))
    .sort((a, b) => b.pts - a.pts || a.i - b.i)
    .forEach((e, idx) => { prev[e.i] = idx + 1; });
  return prev;
}

// Movement is announced in words as well as drawn, so the glyph and its color
// are never the only signal.
function describeMovement(move) {
  if (move > 0) return { cls: "up", glyph: `\u25b2${move}`, words: `up ${move}` };
  if (move < 0) return { cls: "down", glyph: `\u25bc${-move}`, words: `down ${-move}` };
  return { cls: "flat", glyph: "\u2013", words: "no change" };
}

// An absent week reads as a dash, not as a genuine zero.
function lastWeekPoints(team, week) {
  const v = team.ranking_points_by_week[week - 1];
  return v == null ? "\u2014" : v.toFixed(1);
}

function renderTable(teams, meta) {
  const tbody = document.querySelector("#standings-table tbody");
  const prev = previousRanks(teams, meta.completed_weeks);
  const week = meta.completed_weeks;
  const lastWkHead = document.querySelector("#standings-table th.lastwk");
  lastWkHead.textContent = `Wk ${week}`;
  lastWkHead.title = "Ranking points earned in the most recent completed week";
  tbody.innerHTML = "";
  teams.forEach((t, i) => {
    const norm = t.normalized_by_week[t.normalized_by_week.length - 1];
    const mv = describeMovement(prev[i] - (i + 1));
    const tr = document.createElement("tr");
    if (i + 1 === meta.playoff_cutoff) tr.classList.add("cutoff");
    tr.innerHTML =
      `<td class="rk"><span class="rk-num">${t.rank}</span>` +
        `<span class="mv ${mv.cls}"><span class="mv-glyph" aria-hidden="true">${mv.glyph}</span>` +
        `<span class="mv-label sr-only">${mv.words}</span></span></td>` +
      `<td class="left team">${t.team_name}</td>` +
      `<td class="left mgr">${t.owner || ""}</td>` +
      `<td class="lastwk">${lastWeekPoints(t, week)}</td>` +
      `<td class="pts">${t.total_ranking_points}</td>` +
      `<td class="norm ${norm >= 0 ? "pos" : "neg"}">${norm > 0 ? "+" : ""}${norm}</td>`;
    tbody.appendChild(tr);
  });
}

main();
