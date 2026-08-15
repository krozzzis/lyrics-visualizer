// Index of the cue active at time t (last cue whose start <= t), or -1.
// Deliberately independent of camera.js's word-splitMode keyframes: UI
// highlighting (sidebar, timeline blocks) always reflects the subtitle line,
// not the finer-grained word jump the camera might be doing.
export function activeCueIndexAtTime(cues, t) {
  let idx = -1;
  for (let i = 0; i < cues.length; i += 1) {
    if (cues[i].start <= t) idx = i;
    else break;
  }
  return idx;
}
