// Tolerance for matching a cue's start against the current playback time.
// Seeking an <audio> element to an exact boundary (e.g. from the "next
// line" button) doesn't read back exactly that value — browsers snap MP3
// playback to the nearest frame, landing a fraction of a millisecond before
// the requested time — so a strict `<=` comparison would then treat the
// cue as not-yet-reached and get permanently stuck. This is comfortably
// smaller than any real cue gap in practice.
const EPSILON = 0.05;

// Index of the cue active at time t (last cue whose start <= t), or -1.
// Deliberately independent of camera.js's word-splitMode keyframes: UI
// highlighting (sidebar, timeline blocks) always reflects the subtitle line,
// not the finer-grained word jump the camera might be doing.
export function activeCueIndexAtTime(cues, t) {
  let idx = -1;
  for (let i = 0; i < cues.length; i += 1) {
    if (cues[i].start <= t + EPSILON) idx = i;
    else break;
  }
  return idx;
}
