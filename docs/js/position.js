// Position & score analysis pivot — ported from the baseball site, football positions.
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "OP", "D/ST", "K"];

const state = {
  data: null, allWeeks: true, startWeek: 0, endWeek: 0,
  selectedPositions: new Set(POSITION_ORDER), selectedTeams: new Set(),
  showTeamTotals: true, showLeagueTotal: false,
  sortCol: "total", sortDir: -1, viewMode: "byTeam", timeMode: "byWeek",
};
// selectedPositions is populated from the positions that actually appear in the
// data (see setupControls) so empty slots (e.g. OP in a non-superflex league)
// don't render blank rows.

function getWeekIndices() {
  const mw = state.data.metadata.current_matchup_week;
  const start = state.allWeeks ? 0 : state.startWeek;
  const end = state.allWeeks ? mw - 1 : state.endWeek;
  const weeks = [];
  for (let w = start; w <= end; w++) weeks.push(w);
  return weeks;
}

// Cream heat map: pale green (low) -> deep field green (high); blank for 0.
function cellColor(val, min, max) {
  if (val <= 0 || max <= min) return "";
  const t = (val - min) / (max - min);
  return `hsl(132, ${30 + t * 32}%, ${95 - t * 33}%)`;
}

function getVal(team, pos, w) { return state.data.position_scores_by_week[w]?.[team]?.[pos] || 0; }
function getAgg(team, pos, weeks) { let s = 0; for (const w of weeks) s += getVal(team, pos, w); return s; }

// The one definition of "present": this team has this bucket recorded for this
// week. Every view asks this instead of testing the value for positivity, so a
// 0.0 kicker or a negative D/ST reads as a score rather than as missing data.
function hasVal(team, pos, w) { return state.data.position_scores_by_week[w]?.[team]?.[pos] != null; }
// An aggregate is present when any of the selected weeks recorded the bucket.
function hasAgg(team, pos, weeks) { return weeks.some(w => hasVal(team, pos, w)); }

// Present -> the number, sign and all; absent -> the em dash, which now means
// only "no such lineup slot". Heat is untouched: still gated on the raw value
// being positive, still skipped when no range is given. Only the brick-red
// class reads the rounded value, so a float-error -0.004 prints "0.0" plain
// rather than a red "-0.0".
function fillCell(td, val, present, range) {
  if (!present) { td.textContent = "—"; return; }
  const shown = Math.round(val * 10) / 10;
  td.textContent = shown.toFixed(1);
  if (val > 0) { if (range) td.style.background = cellColor(val, range[0], range[1]); }
  else if (shown < 0) td.classList.add("neg");
}

function render() {
  if (!state.data) return;
  const headEl = document.getElementById("pivot-head");
  const bodyEl = document.getElementById("pivot-body");
  const teams = [...state.selectedTeams].sort();
  const positions = POSITION_ORDER.filter(p => state.selectedPositions.has(p));
  const weeks = getWeekIndices();
  if (!teams.length || !positions.length || !weeks.length) {
    headEl.innerHTML = "";
    bodyEl.innerHTML = `<tr><td colspan="99" class="nodata">No data — adjust filters</td></tr>`;
    return;
  }
  if (state.viewMode === "byTeam" && state.timeMode === "byWeek") renderTeamByWeek(headEl, bodyEl, teams, positions, weeks);
  else if (state.viewMode === "byTeam" && state.timeMode === "total") renderTeamTotal(headEl, bodyEl, teams, positions, weeks);
  else if (state.viewMode === "byPosition" && state.timeMode === "byWeek") renderPositionByWeek(headEl, bodyEl, teams, positions, weeks);
  else renderPositionTotal(headEl, bodyEl, teams, positions, weeks);
}

function renderTeamByWeek(headEl, bodyEl, teams, positions, weeks) {
  const weeklyRange = {}, totalRange = {};
  for (const pos of positions) {
    const weekVals = [], totals = [];
    for (const team of teams) {
      let rt = 0;
      for (const w of weeks) { const v = getVal(team, pos, w); weekVals.push(v); rt += v; }
      totals.push(rt);
    }
    weeklyRange[pos] = computeMinMax(weekVals);
    totalRange[pos] = computeMinMax(totals);
  }
  function teamSortVal(team, col) {
    if (col === "team") return 0;
    if (col === "total") { let s = 0; for (const w of weeks) for (const p of positions) s += getVal(team, p, w); return s; }
    let s = 0; for (const p of positions) s += getVal(team, p, col); return s;
  }
  const sortedTeams = [...teams].sort((a, b) => {
    if (state.sortCol === "team") return state.sortDir * a.localeCompare(b);
    const diff = teamSortVal(a, state.sortCol) - teamSortVal(b, state.sortCol);
    return diff !== 0 ? state.sortDir * diff : a.localeCompare(b);
  });
  headEl.innerHTML = "";
  const tr = document.createElement("tr");
  tr.appendChild(makeSortTh("Team", "team", "sticky-col team-col"));
  const posTh = document.createElement("th"); posTh.textContent = "Pos"; posTh.className = "sticky-col2 pos-col";
  tr.appendChild(posTh);
  for (const w of weeks) tr.appendChild(makeSortTh(`Wk ${w + 1}`, w));
  tr.appendChild(makeSortTh("Total", "total", "total-col"));
  headEl.appendChild(tr);
  bodyEl.innerHTML = "";
  for (const team of sortedTeams) {
    const rowCount = positions.length + (state.showTeamTotals ? 1 : 0);
    for (let pi = 0; pi < positions.length; pi++) {
      const pos = positions[pi];
      const row = document.createElement("tr");
      if (pi === 0) row.classList.add("team-first-row");
      if (pi === 0) {
        const td = document.createElement("td"); td.textContent = team; td.rowSpan = rowCount;
        td.className = "sticky-col team-col team-cell"; row.appendChild(td);
      }
      const posTd = document.createElement("td"); posTd.textContent = pos; posTd.className = "sticky-col2 pos-col";
      row.appendChild(posTd);
      let rowTotal = 0;
      for (const w of weeks) {
        const v = getVal(team, pos, w); rowTotal += v;
        const td = document.createElement("td");
        fillCell(td, v, hasVal(team, pos, w), weeklyRange[pos]);
        row.appendChild(td);
      }
      const totalTd = document.createElement("td"); totalTd.className = "total-col";
      fillCell(totalTd, rowTotal, hasAgg(team, pos, weeks), totalRange[pos]);
      row.appendChild(totalTd);
      bodyEl.appendChild(row);
    }
    if (state.showTeamTotals) {
      const totalRow = document.createElement("tr"); totalRow.className = "team-total-row";
      const posTd = document.createElement("td"); posTd.textContent = "Total"; posTd.className = "sticky-col2 pos-col pos-total";
      totalRow.appendChild(posTd);
      let gt = 0;
      for (const w of weeks) {
        const wv = positions.reduce((s, p) => s + getVal(team, p, w), 0); gt += wv;
        const td = document.createElement("td"); td.textContent = wv.toFixed(1); totalRow.appendChild(td);
      }
      const gtTd = document.createElement("td"); gtTd.textContent = gt.toFixed(1); gtTd.className = "total-col";
      totalRow.appendChild(gtTd); bodyEl.appendChild(totalRow);
    }
  }
  appendLeagueRow(bodyEl, teams, positions, weeks);
}

function renderTeamTotal(headEl, bodyEl, teams, positions, weeks) {
  const colRange = {};
  for (const pos of positions) colRange[pos] = computeMinMax(teams.map(t => getAgg(t, pos, weeks)));
  function teamSortVal(team, col) {
    if (col === "team") return 0;
    if (col === "total") return positions.reduce((s, p) => s + getAgg(team, p, weeks), 0);
    return getAgg(team, col, weeks);
  }
  const sortedTeams = [...teams].sort((a, b) => {
    if (state.sortCol === "team") return state.sortDir * a.localeCompare(b);
    const diff = teamSortVal(a, state.sortCol) - teamSortVal(b, state.sortCol);
    return diff !== 0 ? state.sortDir * diff : a.localeCompare(b);
  });
  headEl.innerHTML = "";
  const tr = document.createElement("tr");
  tr.appendChild(makeSortTh("Team", "team", "sticky-col team-col"));
  for (const pos of positions) tr.appendChild(makeSortTh(pos, pos));
  tr.appendChild(makeSortTh("Total", "total", "total-col"));
  headEl.appendChild(tr);
  bodyEl.innerHTML = "";
  for (const team of sortedTeams) {
    const row = document.createElement("tr");
    const nameTd = document.createElement("td"); nameTd.textContent = team; nameTd.className = "sticky-col team-col";
    row.appendChild(nameTd);
    let teamTotal = 0;
    for (const pos of positions) {
      const v = getAgg(team, pos, weeks); teamTotal += v;
      const td = document.createElement("td");
      fillCell(td, v, hasAgg(team, pos, weeks), colRange[pos]); row.appendChild(td);
    }
    const totalTd = document.createElement("td"); totalTd.className = "total-col";
    // No range: the team total spans positions, so it carries no heat scale.
    fillCell(totalTd, teamTotal, positions.some(p => hasAgg(team, p, weeks)));
    row.appendChild(totalTd);
    bodyEl.appendChild(row);
  }
  if (state.showLeagueTotal) {
    const lr = document.createElement("tr"); lr.className = "league-total-row";
    const ltTd = document.createElement("td"); ltTd.textContent = "League"; ltTd.className = "sticky-col team-col team-cell";
    lr.appendChild(ltTd);
    let gt = 0;
    for (const pos of positions) {
      const v = teams.reduce((s, t) => s + getAgg(t, pos, weeks), 0); gt += v;
      const td = document.createElement("td"); td.textContent = v.toFixed(1); lr.appendChild(td);
    }
    const gtTd = document.createElement("td"); gtTd.textContent = gt.toFixed(1); gtTd.className = "total-col";
    lr.appendChild(gtTd); bodyEl.appendChild(lr);
  }
}

function renderPositionByWeek(headEl, bodyEl, teams, positions, weeks) {
  const weeklyRange = {}, totalRange = {};
  for (const pos of positions) {
    const weekVals = [], totals = [];
    for (const team of teams) {
      let rt = 0;
      for (const w of weeks) { const v = getVal(team, pos, w); weekVals.push(v); rt += v; }
      totals.push(rt);
    }
    weeklyRange[pos] = computeMinMax(weekVals); totalRange[pos] = computeMinMax(totals);
  }
  function posSortVal(pos, col) {
    if (col === "pos") return 0;
    if (col === "total") return teams.reduce((s, t) => s + getAgg(t, pos, weeks), 0);
    return teams.reduce((s, t) => s + getVal(t, pos, col), 0);
  }
  const sortedPositions = [...positions].sort((a, b) => {
    if (state.sortCol === "pos") return state.sortDir * (POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b));
    const diff = posSortVal(a, state.sortCol) - posSortVal(b, state.sortCol);
    return diff !== 0 ? state.sortDir * diff : POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b);
  });
  headEl.innerHTML = "";
  const tr = document.createElement("tr");
  tr.appendChild(makeSortTh("Pos", "pos", "sticky-col team-col"));
  const teamTh = document.createElement("th"); teamTh.textContent = "Team"; teamTh.className = "sticky-col2 pos-col";
  tr.appendChild(teamTh);
  for (const w of weeks) tr.appendChild(makeSortTh(`Wk ${w + 1}`, w));
  tr.appendChild(makeSortTh("Total", "total", "total-col"));
  headEl.appendChild(tr);
  bodyEl.innerHTML = "";
  for (const pos of sortedPositions) {
    const inPos = [...teams].sort((a, b) => (getAgg(b, pos, weeks) - getAgg(a, pos, weeks)) || a.localeCompare(b));
    const rowCount = inPos.length + (state.showTeamTotals ? 1 : 0);
    for (let ti = 0; ti < inPos.length; ti++) {
      const team = inPos[ti]; const row = document.createElement("tr");
      if (ti === 0) row.classList.add("team-first-row");
      if (ti === 0) {
        const td = document.createElement("td"); td.textContent = pos; td.rowSpan = rowCount;
        td.className = "sticky-col team-col team-cell"; row.appendChild(td);
      }
      const teamTd = document.createElement("td"); teamTd.textContent = team; teamTd.className = "sticky-col2 pos-col";
      row.appendChild(teamTd);
      let rt = 0;
      for (const w of weeks) {
        const v = getVal(team, pos, w); rt += v;
        const td = document.createElement("td");
        fillCell(td, v, hasVal(team, pos, w), weeklyRange[pos]); row.appendChild(td);
      }
      const totalTd = document.createElement("td"); totalTd.className = "total-col";
      fillCell(totalTd, rt, hasAgg(team, pos, weeks), totalRange[pos]);
      row.appendChild(totalTd); bodyEl.appendChild(row);
    }
    if (state.showTeamTotals) {
      const totalRow = document.createElement("tr"); totalRow.className = "team-total-row";
      const td = document.createElement("td"); td.textContent = "Total"; td.className = "sticky-col2 pos-col pos-total";
      totalRow.appendChild(td);
      let gt = 0;
      for (const w of weeks) {
        const wv = teams.reduce((s, t) => s + getVal(t, pos, w), 0); gt += wv;
        const wtd = document.createElement("td"); wtd.textContent = wv.toFixed(1); totalRow.appendChild(wtd);
      }
      const gtTd = document.createElement("td"); gtTd.textContent = gt.toFixed(1); gtTd.className = "total-col";
      totalRow.appendChild(gtTd); bodyEl.appendChild(totalRow);
    }
  }
}

function renderPositionTotal(headEl, bodyEl, teams, positions, weeks) {
  const rowMinMax = {};
  for (const pos of positions) rowMinMax[pos] = computeMinMax(teams.map(t => getAgg(t, pos, weeks)));
  function posSortVal(pos, col) { if (col === "pos") return 0; return getAgg(col, pos, weeks); }
  const sortedPositions = [...positions].sort((a, b) => {
    if (state.sortCol === "pos") return state.sortDir * (POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b));
    const diff = posSortVal(a, state.sortCol) - posSortVal(b, state.sortCol);
    return diff !== 0 ? state.sortDir * diff : POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b);
  });
  headEl.innerHTML = "";
  const tr = document.createElement("tr");
  tr.appendChild(makeSortTh("Pos", "pos", "sticky-col team-col"));
  for (const team of teams) tr.appendChild(makeSortTh(team, team));
  headEl.appendChild(tr);
  bodyEl.innerHTML = "";
  for (const pos of sortedPositions) {
    const row = document.createElement("tr");
    const posTd = document.createElement("td"); posTd.textContent = pos; posTd.className = "sticky-col team-col";
    row.appendChild(posTd);
    for (const team of teams) {
      const v = getAgg(team, pos, weeks);
      const td = document.createElement("td");
      fillCell(td, v, hasAgg(team, pos, weeks), rowMinMax[pos]); row.appendChild(td);
    }
    bodyEl.appendChild(row);
  }
}

function computeMinMax(values) {
  let min = Infinity, max = -Infinity;
  for (const v of values) if (v > 0) { if (v < min) min = v; if (v > max) max = v; }
  return [min, max];
}

function makeSortTh(label, sortKey, extraClass) {
  const th = document.createElement("th");
  const active = state.sortCol === sortKey;
  th.className = "sortable-col" + (active ? " sort-active" : "") + (extraClass ? " " + extraClass : "");
  th.innerHTML = label + (active ? ` <span class="sort-arrow">${state.sortDir === -1 ? "▼" : "▲"}</span>` : "");
  th.style.cursor = "pointer";
  th.addEventListener("click", () => {
    if (state.sortCol === sortKey) state.sortDir *= -1; else { state.sortCol = sortKey; state.sortDir = -1; }
    render();
  });
  return th;
}

function appendLeagueRow(bodyEl, teams, positions, weeks) {
  if (!state.showLeagueTotal) return;
  const lr = document.createElement("tr"); lr.className = "league-total-row";
  const teamTd = document.createElement("td"); teamTd.textContent = "League"; teamTd.className = "sticky-col team-col team-cell";
  lr.appendChild(teamTd);
  const posTd = document.createElement("td"); posTd.textContent = "Total"; posTd.className = "sticky-col2 pos-col pos-total";
  lr.appendChild(posTd);
  let gt = 0;
  for (const w of weeks) {
    const wv = teams.reduce((s, t) => s + positions.reduce((ps, p) => ps + getVal(t, p, w), 0), 0); gt += wv;
    const td = document.createElement("td"); td.textContent = wv.toFixed(1); lr.appendChild(td);
  }
  const gtTd = document.createElement("td"); gtTd.textContent = gt.toFixed(1); gtTd.className = "total-col";
  lr.appendChild(gtTd); bodyEl.appendChild(lr);
}

function setupControls(data) {
  const mw = data.metadata.current_matchup_week;
  state.endWeek = mw - 1;
  initToggle("view-toggle", v => { state.viewMode = v; state.sortCol = "total"; state.sortDir = -1; render(); });
  initToggle("time-toggle", v => { state.timeMode = v; state.sortCol = "total"; state.sortDir = -1; render(); });
  const allWeeksCb = document.getElementById("all-weeks-cb");
  const weekRangeDiv = document.getElementById("week-range");
  const startSel = document.getElementById("start-week"), endSel = document.getElementById("end-week");
  for (let i = 0; i < mw; i++) { startSel.appendChild(new Option(`Week ${i + 1}`, i)); endSel.appendChild(new Option(`Week ${i + 1}`, i)); }
  endSel.value = mw - 1;
  allWeeksCb.addEventListener("change", () => { state.allWeeks = allWeeksCb.checked; weekRangeDiv.style.display = allWeeksCb.checked ? "none" : "flex"; render(); });
  startSel.addEventListener("change", () => { state.startWeek = +startSel.value; if (state.startWeek > state.endWeek) { state.endWeek = state.startWeek; endSel.value = state.endWeek; } render(); });
  endSel.addEventListener("change", () => { state.endWeek = +endSel.value; if (state.endWeek < state.startWeek) { state.startWeek = state.endWeek; startSel.value = state.startWeek; } render(); });

  const posContainer = document.getElementById("position-checkboxes");
  const available = new Set();
  for (const week of data.position_scores_by_week) for (const ts of Object.values(week)) for (const pos of Object.keys(ts)) available.add(pos);
  state.selectedPositions = new Set();   // only positions that actually exist
  for (const pos of POSITION_ORDER) {
    if (!available.has(pos)) continue;
    state.selectedPositions.add(pos);
    const label = document.createElement("label"); label.className = "checkbox-label";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true; cb.value = pos;
    cb.addEventListener("change", () => { if (cb.checked) state.selectedPositions.add(pos); else state.selectedPositions.delete(pos); render(); });
    label.appendChild(cb); label.appendChild(document.createTextNode(" " + pos)); posContainer.appendChild(label);
  }
  document.getElementById("pos-all").addEventListener("click", () => { posContainer.querySelectorAll("input").forEach(cb => { cb.checked = true; state.selectedPositions.add(cb.value); }); render(); });
  document.getElementById("pos-none").addEventListener("click", () => { posContainer.querySelectorAll("input").forEach(cb => { cb.checked = false; state.selectedPositions.delete(cb.value); }); render(); });

  const teamContainer = document.getElementById("team-checkboxes");
  const allTeams = [...new Set(data.position_scores_by_week.flatMap(w => Object.keys(w)))].sort();
  for (const team of allTeams) {
    state.selectedTeams.add(team);
    const label = document.createElement("label"); label.className = "checkbox-label";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true; cb.value = team;
    cb.addEventListener("change", () => { if (cb.checked) state.selectedTeams.add(team); else state.selectedTeams.delete(team); render(); });
    label.appendChild(cb); label.appendChild(document.createTextNode(" " + team)); teamContainer.appendChild(label);
  }
  document.getElementById("team-all").addEventListener("click", () => { teamContainer.querySelectorAll("input").forEach(cb => { cb.checked = true; state.selectedTeams.add(cb.value); }); render(); });
  document.getElementById("team-none").addEventListener("click", () => { teamContainer.querySelectorAll("input").forEach(cb => { cb.checked = false; state.selectedTeams.delete(cb.value); }); render(); });

  document.getElementById("show-team-totals").addEventListener("change", e => { state.showTeamTotals = e.target.checked; render(); });
  document.getElementById("show-league-total").addEventListener("change", e => { state.showLeagueTotal = e.target.checked; render(); });
}

function initToggle(id, onChange) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  wrap.querySelectorAll(".pivot-toggle-btn").forEach(btn => btn.addEventListener("click", () => {
    wrap.querySelectorAll(".pivot-toggle-btn").forEach(b => b.classList.toggle("active", b === btn));
    onChange(btn.dataset.value);
  }));
}

fetch("data/league_data.json", { cache: "no-store" })
  .then(r => r.json())
  .then(data => {
    const mw = data.metadata?.current_matchup_week || 0;
    if (!mw || !data.position_scores_by_week?.length) {
      document.getElementById("empty-state").classList.remove("hidden");
      showScoreboardPreview(data.metadata);
      return;
    }
    state.data = data;
    // Season first, then what the page shows, then the timestamp where it was.
    const lu = document.getElementById("last-updated");
    const parts = [];
    if (data.metadata?.season) parts.push(`${data.metadata.season} season`);
    parts.push("Points by position");
    if (data.metadata?.updated_at) parts.push("updated " + data.metadata.updated_at);
    lu.textContent = parts.join(" · ");
    document.getElementById("pivot-section").classList.remove("hidden");
    setupControls(data);
    render();
  })
  .catch(() => document.getElementById("empty-state").classList.remove("hidden"));
