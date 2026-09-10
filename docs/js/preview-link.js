// The empty state's way out, shared by Standings and Position & Score Analysis.
// Both count only final weeks, so on kickoff week they have nothing to draw
// while the Scoreboard is already previewing Week 1. One copy of the rule,
// because the week the sentence names has to be the week the link lands on.

/**
 * Reveal the "previewed on the Scoreboard" sentence, if there is a week to
 * point at. `meta` is the standings file's metadata: week_files lists the
 * weeks with a file and current_week names the one the Scoreboard opens on.
 * With no week file ESPN has served no week of this season, and the sentence
 * would link to an empty Scoreboard, so it stays hidden.
 */
function showScoreboardPreview(meta) {
  const el = document.querySelector("#empty-state .preview-link");
  const weeks = (meta && meta.week_files) || [];
  if (!weeks.length) return;
  // The same resolution the Scoreboard itself opens on: the current week when
  // it is one of the weeks we have, else the most recent one. By membership,
  // not by truthiness, so a current_week nobody wrote a file for names the
  // week the link actually lands on rather than the one the metadata claims.
  const week = weeks.includes(meta.current_week)
    ? meta.current_week : weeks[weeks.length - 1];
  el.querySelector(".preview-week").textContent = week;
  el.classList.remove("hidden");
}
