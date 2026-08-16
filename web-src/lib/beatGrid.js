// A bar is always a whole note — 4 quarter-note beats, i.e. 240/bpm seconds
// — regardless of the grid resolution. beatsPerBar (4/8/16/32, matching note
// values 1/4-1/32) only picks how many equal ticks each bar is divided into
// for display/snapping; it never changes where bar lines fall or how many
// bars the track has.
export function barDuration(bpm) {
  return 240 / bpm;
}

// Beat grid lines between startTime and endTime (seconds).
// gridOffset is the time of the first downbeat (bar line), matching the
// convention documented in config.example.yaml.
export function beatsInRange(bpm, beatsPerBar, gridOffset, startTime, endTime) {
  if (!bpm || bpm <= 0 || !Number.isFinite(bpm)) return [];
  const bpb = beatsPerBar > 0 ? beatsPerBar : 4;
  const tickDuration = barDuration(bpm) / bpb;

  const firstIndex = Math.ceil((startTime - gridOffset) / tickDuration);
  const beats = [];
  for (let n = firstIndex; ; n += 1) {
    const time = gridOffset + n * tickDuration;
    if (time > endTime) break;
    const isBar = ((n % bpb) + bpb) % bpb === 0;
    beats.push({ time, isBar });
  }
  return beats;
}
