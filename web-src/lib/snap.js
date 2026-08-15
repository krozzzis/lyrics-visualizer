// Nearest beat-grid time to t, per the same convention as beatGrid.js
// (gridOffset = time of the first downbeat). Returns t unchanged when there's
// no tempo to snap to.
export function snapToGrid(t, bpm, gridOffset) {
  if (!bpm || bpm <= 0 || !Number.isFinite(bpm)) return t;
  const beatDuration = 60 / bpm;
  const n = Math.round((t - gridOffset) / beatDuration);
  return gridOffset + n * beatDuration;
}
