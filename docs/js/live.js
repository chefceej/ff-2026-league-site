// Live Hub: the current week's ranking-points race, re-read from
// league_data.json every minute (the data itself refreshes ~every 10 min on
// game days via cron-job.org -> workflow_dispatch).
const PALETTE = [
  "#2f7d4f", "#2b5c8a", "#b0402f", "#d1791f", "#1f8a86", "#7a4fa3",
  "#b8892b", "#566270", "#a8324a", "#6b7a2f", "#8a5a3c", "#a0498f",
];
const AXIS = "#7c7862", GRID = "#e6dcc4", LEG = "#20302a";
const TZ = "America/Chicago";
const POLL_MS = 60 * 1000;

let mode = "live";            // "live" | "proj"
const expanded = new Set();   // team abbrevs with the lineup drawer open
let jostleChart = null;
let lastData = null;

const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ord = n => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] ||
  ["th", "st", "nd", "rd"][n % 100] || "th");
const fmt = v => (Math.round(v * 10) / 10).toFixed(1);
const signed = v => (v > 0 ? "+" : v < 0 ? "−" : "±") + fmt(Math.abs(v)).replace(/\.0$/, "");
const timeCT = iso => new Date(iso).toLocaleTimeString("en-US",
  { timeZone: TZ, hour: "numeric", minute: "2-digit" });

// {abbrev: score} -> {abbrev: ranking points}; best = n, worst = 1, ties averaged
// (same rule as fetch_data.assign_ranking_points).
function rankingPoints(scores) {
  const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const n = ordered.length, out = {};
  for (let i = 0; i < n;) {
    let j = i;
    while (j < n - 1 && ordered[j][1] === ordered[j + 1][1]) j++;
    let sum = 0;
    for (let k = i; k <= j; k++) sum += n - k;
    for (let k = i; k <= j; k++) out[ordered[k][0]] = sum / (j - i + 1);
    i = j + 1;
  }
  return out;
}
// Ordered abbrevs, best first.
const order = scores => Object.keys(scores).sort((a, b) => scores[b] - scores[a]);

// Season standings if the week ended with these scores.
function standingsFor(scores, base, cutoff) {
  const rp = rankingPoints(scores);
  const rows = Object.keys(scores).map(a => ({ abbrev: a, before: base[a] || 0, add: rp[a],
    total: (base[a] || 0) + rp[a] }));
  rows.sort((x, y) => y.total - x.total || y.add - x.add);
  const cutVal = rows[Math.min(cutoff, rows.length) - 1]?.total ?? 0;
  rows.forEach((r, i) => { r.rank = i + 1; r.vsCut = r.total - cutVal; });
  return rows;
}

function statusCounts(starters) {
  const c = { final: 0, live: 0, pre: 0, bye: 0 };
  starters.forEach(p => { c[p.status] = (c[p.status] || 0) + 1; });
  return c;
}
function pips(starters) {
  const rank = { final: 0, live: 1, pre: 2, bye: 3 };
  return [...starters].sort((a, b) => rank[a.status] - rank[b.status])
    .map(p => `<span class="pip ${p.status}" title="${esc(p.name)} · ${p.status}"></span>`).join("");
}

async function load() {
  try {
    const res = await fetch("data/league_data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    lastData = await res.json();
  } catch (e) {
    if (!lastData) showEmpty("Couldn't load league data yet.");
    return;
  }
  render(lastData);
}

function showEmpty(msg) {
  if (msg) document.getElementById("empty-msg").textContent = msg;
  document.getElementById("empty-state").classList.remove("hidden");
}
const show = id => document.getElementById(id).classList.remove("hidden");

function render(data) {
  const meta = data.metadata || {};
  const live = data.live;
  if (!live || !live.teams || !Object.keys(live.teams).length) { showEmpty(); return; }
  document.getElementById("empty-state").classList.add("hidden");

  const week = live.week;
  const cutoff = meta.playoff_cutoff || 6;
  const regWeeks = meta.regular_season_weeks || 14;
  const byAbbrev = {};
  (data.teams || []).forEach(t => { byAbbrev[t.team_abbrev || t.abbrev] = t; });
  const name = a => byAbbrev[a]?.team_name || a;
  // Ranking points banked before this week.
  const base = {};
  Object.keys(live.teams).forEach(a => {
    const cum = byAbbrev[a]?.cumulative_points_by_week || [];
    base[a] = week >= 2 ? (cum[week - 2] ?? 0) : 0;
  });

  const all = Object.values(live.teams).flatMap(t => t.starters || []);
  const counts = statusCounts(all);
  const done = counts.live === 0 && counts.pre === 0;
  const color = {};
  Object.keys(live.teams).sort().forEach((a, i) => { color[a] = PALETTE[i % PALETTE.length]; });

  // ── Banner ──
  show("live-top");
  const stateEl = document.getElementById("lb-state");
  stateEl.textContent = done ? "FINAL" : counts.live ? "LIVE" : "UPCOMING";
  stateEl.className = "lb-state " + (done ? "final" : counts.live ? "live" : "pre");
  document.getElementById("lb-week").textContent =
    `Week ${week}${week <= regWeeks ? ` of ${regWeeks}` : ""}`;
  document.getElementById("lb-pips").innerHTML =
    `<span><b>${counts.final}</b> final</span><span class="sep">·</span>` +
    `<span><b>${counts.live}</b> playing</span><span class="sep">·</span>` +
    `<span><b>${counts.pre}</b> yet to play</span>`;
  const mins = Math.round((Date.now() - new Date(live.updated_at)) / 60000);
  document.getElementById("lb-updated").textContent =
    `Scores as of ${timeCT(live.updated_at)} CT` + (mins >= 1 ? ` (${mins} min ago)` : "");
  document.getElementById("updated").textContent =
    `Live data refreshes about every 10 minutes during games · page re-checks every minute`;
  document.getElementById("max-pts").textContent = Object.keys(live.teams).length;

  // ── Race board ──
  const liveScores = {}, projScores = {};
  Object.entries(live.teams).forEach(([a, t]) => {
    liveScores[a] = t.score; projScores[a] = Math.max(t.projected, t.score);
  });
  const scores = mode === "proj" ? projScores : liveScores;
  const rp = rankingPoints(scores);
  const ranked = order(scores);
  const maxScore = Math.max(...Object.values(projScores), 1);
  const tbody = document.querySelector("#race-table tbody");
  tbody.innerHTML = "";
  ranked.forEach((a, i) => {
    const t = live.teams[a];
    const c = statusCounts(t.starters || []);
    const above = ranked[i - 1];
    const gap = above != null ? scores[above] - scores[a] : null;
    const tr = document.createElement("tr");
    tr.className = "race-row" + (expanded.has(a) ? " open" : "");
    tr.innerHTML =
      `<td class="rk">${i + 1}</td>` +
      `<td class="left team"><span class="swatch" style="background:${color[a]}"></span>${esc(name(a))}` +
      ` <span class="abbr">${esc(a)}</span></td>` +
      `<td class="score">${fmt(scores[a])}</td>` +
      `<td class="left bar-col"><div class="bar"><div class="bar-proj" style="width:${projScores[a] / maxScore * 100}%"></div>` +
      `<div class="bar-live" style="width:${liveScores[a] / maxScore * 100}%;background:${color[a]}"></div></div></td>` +
      `<td class="mut">${fmt(projScores[a])}</td>` +
      `<td class="left"><span class="pips">${pips(t.starters || [])}</span>` +
      `<span class="left-ct">${c.live + c.pre ? `${c.live + c.pre} left` : "done"}</span></td>` +
      `<td class="mut">${gap == null ? "—" : `${fmt(gap)} back`}</td>` +
      `<td class="rp">${String(rp[a]).replace(/\.5$/, "½")}</td>`;
    tr.onclick = () => { expanded.has(a) ? expanded.delete(a) : expanded.add(a); render(lastData); };
    tbody.appendChild(tr);
    if (expanded.has(a)) {
      const dr = document.createElement("tr");
      dr.className = "drawer";
      const rows = [...(t.starters || [])].map(p =>
        `<div class="lp ${p.status}"><span class="lp-slot">${esc(p.slot)}</span>` +
        `<span class="lp-name">${esc(p.name)}</span>` +
        `<span class="lp-game">${esc(p.pro_team)}${p.opponent && p.opponent !== "None" ? ` vs ${esc(p.opponent)}` : ""}` +
        ` · ${p.status === "pre" && p.kickoff ? new Date(p.kickoff).toLocaleString("en-US",
          { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" }) : p.status}</span>` +
        `<span class="lp-pts">${fmt(p.points)}<small> / ${fmt(p.projected)}</small></span></div>`).join("");
      dr.innerHTML = `<td colspan="8"><div class="lineup">${rows}</div></td>`;
      tbody.appendChild(dr);
    }
  });
  show("race-section");

  // ── Tightest battles: adjacent weekly ranks, smallest gaps ──
  const battles = [];
  for (let i = 1; i < ranked.length; i++) {
    const hi = ranked[i - 1], lo = ranked[i];
    battles.push({ hi, lo, spot: i, gap: scores[hi] - scores[lo] });
  }
  const left = a => { const c = statusCounts(live.teams[a].starters || []); return c.live + c.pre; };
  document.getElementById("battles").innerHTML = battles
    .filter(b => !done || b.gap > 0).sort((x, y) => x.gap - y.gap).slice(0, 4).map(b =>
      `<div class="battle"><div class="b-spot">for ${ord(b.spot)}</div>` +
      `<div class="b-line"><span class="swatch" style="background:${color[b.hi]}"></span>` +
      `<b>${esc(name(b.hi))}</b><span class="b-left">${left(b.hi)} left</span></div>` +
      `<div class="b-gap">${b.gap === 0 ? "dead even" : `by ${fmt(b.gap)}`}</div>` +
      `<div class="b-line"><span class="swatch" style="background:${color[b.lo]}"></span>` +
      `${esc(name(b.lo))}<span class="b-left">${left(b.lo)} left</span></div></div>`).join("");
  show("battles-section");

  // ── Standings if the week ended now ──
  const rows = standingsFor(scores, base, cutoff);
  const enteringRank = {};
  Object.keys(base).sort((x, y) => base[y] - base[x]).forEach((a, i) => { enteringRank[a] = i + 1; });
  const sb = document.querySelector("#live-standings-table tbody");
  sb.innerHTML = "";
  rows.forEach(r => {
    const mv = enteringRank[r.abbrev] - r.rank;
    const tr = document.createElement("tr");
    if (r.rank === cutoff) tr.classList.add("cutoff");
    if (r.rank <= cutoff) tr.classList.add("in");
    tr.innerHTML =
      `<td>${r.rank}</td>` +
      `<td class="move ${mv > 0 ? "up" : mv < 0 ? "down" : ""}">${mv > 0 ? `▲${mv}` : mv < 0 ? `▼${-mv}` : "–"}</td>` +
      `<td class="left team"><span class="swatch" style="background:${color[r.abbrev]}"></span>${esc(name(r.abbrev))}</td>` +
      `<td class="mut">${fmt(r.before).replace(/\.0$/, "")}</td>` +
      `<td class="rp">+${String(r.add).replace(/\.5$/, "½")}</td>` +
      `<td class="team">${fmt(r.total).replace(/\.0$/, "")}</td>` +
      `<td class="norm ${r.vsCut > 0 ? "pos" : r.vsCut < 0 ? "neg" : ""}">${signed(r.vsCut)}</td>`;
    sb.appendChild(tr);
  });
  show("standings-section");

  // ── Jostle chart + play-by-play, both from the snapshot history ──
  const hist = (live.history || []).filter(h => h.scores && Object.keys(h.scores).length);
  if (hist.length >= 2) {
    renderJostle(hist, color, name);
    show("jostle-section");
  }
  renderFeed(hist, base, cutoff, name);
  show("feed-section");
}

function renderJostle(hist, color, name) {
  const labels = hist.map(h => timeCT(h.t));
  const ranksAt = hist.map(h => { const o = order(h.scores); const r = {}; o.forEach((a, i) => { r[a] = i + 1; }); return r; });
  const teams = Object.keys(hist[hist.length - 1].scores);
  const n = teams.length;
  const datasets = teams.map(a => ({
    label: name(a),
    data: ranksAt.map(r => r[a] ?? null),
    borderColor: color[a], backgroundColor: color[a],
    stepped: "middle", borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
  }));
  if (jostleChart) {
    jostleChart.data.labels = labels;
    jostleChart.data.datasets.forEach((ds, i) => { if (datasets[i]) ds.data = datasets[i].data; });
    jostleChart.update("none");
    return;
  }
  jostleChart = new Chart(document.getElementById("jostleChart"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { labels: { color: LEG, boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${ord(c.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: AXIS, maxTicksLimit: 10 }, grid: { color: GRID } },
        y: {
          reverse: true, min: 1, max: n,
          ticks: { color: AXIS, stepSize: 1, callback: v => ord(v) }, grid: { color: GRID },
          title: { display: true, text: "Rank this week", color: AXIS },
        },
      },
    },
  });
}

// Lead changes between consecutive snapshots, newest first.
function renderFeed(hist, base, cutoff, name) {
  const items = [];
  for (let i = 1; i < hist.length; i++) {
    const prev = hist[i - 1].scores, cur = hist[i].scores;
    const pr = {}, cr = {};
    order(prev).forEach((a, k) => { pr[a] = k; });
    const co = order(cur);
    co.forEach((a, k) => { cr[a] = k; });
    const at = timeCT(hist[i].t);
    co.forEach(a => {
      if (!(a in pr)) return;
      const passed = co.filter(b => b !== a && b in pr && pr[b] < pr[a] && cr[b] > cr[a]);
      if (!passed.length) return;
      const who = passed.map(b => `<b>${esc(name(b))}</b>`).join(", ");
      items.push({ at, cls: "climb",
        html: `<b>${esc(name(a))}</b> passes ${who} and climbs to <b>${ord(cr[a] + 1)}</b> this week ` +
          `(${pr[a] - cr[a] > 0 ? "+" : ""}${pr[a] - cr[a]} rank pt${pr[a] - cr[a] === 1 ? "" : "s"})` });
    });
    // Playoff line crossings in the if-it-ended-now standings.
    const ps = standingsFor(prev, base, cutoff), cs = standingsFor(cur, base, cutoff);
    const pin = new Set(ps.filter(r => r.rank <= cutoff).map(r => r.abbrev));
    cs.forEach(r => {
      const nowIn = r.rank <= cutoff;
      if (nowIn && !pin.has(r.abbrev))
        items.push({ at, cls: "in", html: `🏈 <b>${esc(name(r.abbrev))}</b> moves into a playoff spot (${ord(r.rank)})` });
      else if (!nowIn && pin.has(r.abbrev))
        items.push({ at, cls: "out", html: `<b>${esc(name(r.abbrev))}</b> slips below the playoff line (${ord(r.rank)})` });
    });
  }
  const ul = document.getElementById("feed");
  ul.innerHTML = items.length
    ? items.reverse().slice(0, 40).map(it =>
        `<li class="${it.cls}"><span class="f-time">${it.at}</span><span>${it.html}</span></li>`).join("")
    : `<li class="quiet"><span class="f-time">—</span><span>No lead changes yet. Updates appear here as scores move.</span></li>`;
}

document.querySelectorAll("#mode-toggle .pivot-toggle-btn").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll("#mode-toggle .pivot-toggle-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  mode = btn.dataset.mode;
  if (lastData) render(lastData);
}));

load();
setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
