// The empty state's way out, shared by Standings and Position & Score Analysis.
// Both pages count only final weeks, so on kickoff week they have nothing to
// draw while the Scoreboard is already previewing Week 1. One copy, because
// two would drift and a drifted sentence would name the wrong week.

/**
 * Reveal the "previewed on the Scoreboard" sentence, if there is a week to
 * point at. `meta` is the standings file's metadata: week_files lists the
 * weeks with a file and current_week names the one the Scoreboard opens on.
 * With neither, ESPN has served no week of this season and the sentence would
 * link to an empty Scoreboard, so it stays hidden.
 */
function showScoreboardPreview(meta) {
  const el = document.querySelector("#empty-state .preview-link");
  if (!el) return;
  const weeks = (meta && meta.week_files) || [];
  if (!weeks.length) return;
  // current_week is the week the Scoreboard opens on; the last published week
  // is what it falls back to, the same order the Scoreboard itself resolves in.
  const week = (meta && meta.current_week) || weeks[weeks.length - 1];
  el.querySelector(".preview-week").textContent = week;
  el.classList.remove("hidden");
}
