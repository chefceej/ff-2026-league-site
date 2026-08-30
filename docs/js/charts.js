// Render the league standings + playoff-position chart from league_data.json.
const PALETTE = [
  "#4ea1ff", "#48c774", "#f2554d", "#f5a623", "#b06cf0", "#22c1c3",
  "#ff7ab6", "#9fd356", "#e8814a", "#6f8bff", "#c0c74a", "#4ad6a8",
];

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
        legend: { labels: { color: "#8b93a3", boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y > 0 ? "+" : ""}${c.parsed.y}` } },
      },
      scales: {
        x: { ticks: { color: "#8b93a3" }, grid: { color: "#262b36" } },
        y: {
          ticks: { color: "#8b93a3" }, grid: { color: "#262b36" },
          title: { display: true, text: "Points vs. playoff cutoff", color: "#8b93a3" },
        },
      },
    },
  });
}

function renderTable(teams, meta) {
  const tbody = document.querySelector("#standings-table tbody");
  tbody.innerHTML = "";
  teams.forEach((t, i) => {
    const norm = t.normalized_by_week[t.normalized_by_week.length - 1];
    const tr = document.createElement("tr");
    if (i + 1 === meta.playoff_cutoff) tr.classList.add("cutoff");
    tr.innerHTML =
      `<td>${t.rank}</td>` +
      `<td class="left team">${t.team_name}</td>` +
      `<td class="left mgr">${t.owner || ""}</td>` +
      `<td>${t.total_ranking_points}</td>` +
      `<td class="norm ${norm >= 0 ? "pos" : "neg"}">${norm > 0 ? "+" : ""}${norm}</td>`;
    tbody.appendChild(tr);
  });
}

main();
