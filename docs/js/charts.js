// Render the league standings + playoff-position chart from league_data.json.
// Medium-dark, distinct hues that read cleanly on a cream background.
const PALETTE = [
  "#2f7d4f", "#2b5c8a", "#b0402f", "#d1791f", "#1f8a86", "#7a4fa3",
  "#b8892b", "#566270", "#a8324a", "#6b7a2f", "#8a5a3c", "#a0498f",
];
const AXIS = "#7c7862", GRID = "#e6dcc4", LEG = "#20302a";

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

  document.getElementById("subtitle").textContent =
    `${meta.num_teams}-team league · normalized so #${meta.playoff_cutoff} = 0 ` +
    `· ${meta.completed_weeks} week${meta.completed_weeks > 1 ? "s" : ""} played`;

  show("chart-section");
  show("table-section");
  renderChart(teams, meta);
  renderTable(teams, meta);

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
  const datasets = teams.map((t, i) => ({
    label: t.team_name,
    data: t.normalized_by_week,
    borderColor: PALETTE[i % PALETTE.length],
    backgroundColor: PALETTE[i % PALETTE.length],
    tension: 0.25, borderWidth: 2, pointRadius: 2,
  }));
  new Chart(document.getElementById("positionChart"), {
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
          ticks: { color: AXIS }, grid: { color: GRID },
          title: { display: true, text: "Points vs. playoff cutoff", color: AXIS },
        },
      },
    },
  });
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
function movementCell(move) {
  if (move > 0) return { cls: "up", glyph: `\u25b2${move}`, words: `up ${move}` };
  if (move < 0) return { cls: "down", glyph: `\u25bc${-move}`, words: `down ${-move}` };
  return { cls: "flat", glyph: "\u2013", words: "no change" };
}

function renderTable(teams, meta) {
  const tbody = document.querySelector("#standings-table tbody");
  const prev = previousRanks(teams, meta.completed_weeks);
  tbody.innerHTML = "";
  teams.forEach((t, i) => {
    const norm = t.normalized_by_week[t.normalized_by_week.length - 1];
    const mv = movementCell(prev[i] - (i + 1));
    const tr = document.createElement("tr");
    if (i + 1 === meta.playoff_cutoff) tr.classList.add("cutoff");
    tr.innerHTML =
      `<td class="rk"><span class="rk-num">${t.rank}</span>` +
        `<span class="mv ${mv.cls}"><span class="mv-glyph" aria-hidden="true">${mv.glyph}</span>` +
        `<span class="mv-label sr-only">${mv.words}</span></span></td>` +
      `<td class="left team">${t.team_name}</td>` +
      `<td class="left mgr">${t.owner || ""}</td>` +
      `<td class="pts">${t.total_ranking_points}</td>` +
      `<td class="norm ${norm >= 0 ? "pos" : "neg"}">${norm > 0 ? "+" : ""}${norm}</td>`;
    tbody.appendChild(tr);
  });
}

main();
