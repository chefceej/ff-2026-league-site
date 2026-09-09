// How a team's rank moved, shared by the pages that draw it.
// The Standings table owns the look; the Scoreboard's projected standings
// block reads the same function so a projected move and a settled one are the
// same glyph, the same colour and the same words. One copy, because two would
// drift and a drifted arrow says the opposite of what happened.

// Movement is announced in words as well as drawn, so the glyph and its color
// are never the only signal.
function describeMovement(move) {
  if (move > 0) return { cls: "up", glyph: `▲${move}`, words: `up ${move}` };
  if (move < 0) return { cls: "down", glyph: `▼${-move}`, words: `down ${-move}` };
  return { cls: "flat", glyph: "–", words: "no change" };
}

// The indicator as both tables draw it: the glyph for the eye, the words for a
// screen reader. Markup as well as arithmetic lives here, because a movement
// drawn from the same numbers in two shapes is still two things to keep in step.
function movementCell(move) {
  const mv = describeMovement(move);
  return `<span class="mv ${mv.cls}">` +
           `<span class="mv-glyph" aria-hidden="true">${mv.glyph}</span>` +
           `<span class="mv-label sr-only">${mv.words}</span></span>`;
}
