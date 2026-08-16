import { barDuration } from './beatGrid.js';

// Nearest grid-tick time to t, per the same convention as beatGrid.js
// (gridOffset = time of the first downbeat, beatsPerBar = ticks per bar).
// Returns t unchanged when there's no tempo to snap to.
export function snapToGrid(t, bpm, beatsPerBar, gridOffset) {
  if (!bpm || bpm <= 0 || !Number.isFinite(bpm)) return t;
  const bpb = beatsPerBar > 0 ? beatsPerBar : 4;
  const tickDuration = barDuration(bpm) / bpb;
  const n = Math.round((t - gridOffset) / tickDuration);
  return gridOffset + n * tickDuration;
}
