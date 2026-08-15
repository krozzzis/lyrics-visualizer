// Beat grid lines between startTime and endTime (seconds).
// gridOffset is the time of the first downbeat (bar line), matching the
// convention documented in config.example.yaml.
export function beatsInRange(bpm, beatsPerBar, gridOffset, startTime, endTime) {
  if (!bpm || bpm <= 0 || !Number.isFinite(bpm)) return [];
  const bpb = beatsPerBar > 0 ? beatsPerBar : 4;
  const beatDuration = 60 / bpm;

  const firstIndex = Math.ceil((startTime - gridOffset) / beatDuration);
  const beats = [];
  for (let n = firstIndex; ; n += 1) {
    const time = gridOffset + n * beatDuration;
    if (time > endTime) break;
    const isBar = ((n % bpb) + bpb) % bpb === 0;
    beats.push({ time, isBar });
  }
  return beats;
}
