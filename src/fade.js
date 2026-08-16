// Shared math for the two independent exit animations drawFrame applies on
// top of the base active/inactive opacity (see src/scene.js):
//
//   - style.cueExit  — a cue's words leave the screen entirely once its own
//     `end` timestamp (plus delay) has passed, whether or not the next cue
//     has already started (covers gaps where the old cue would otherwise
//     stay at full activeOpacity forever).
//   - style.fadeOut  — a superseded cue/line/word dims from activeOpacity
//     toward inactiveOpacity over time, instead of snapping instantly.
//
// Both are pure functions of precomputed static trigger timestamps and the
// live playback time t — no persistent per-word state — matching the rest
// of this module's "precompute once in prepareScene, pure per-frame draw"
// pattern (see src/camera.js's jumpProgress).

// For each cue index, the time the NEXT cue's jump keyframe fires — i.e. the
// moment this cue stops being the active one. Infinity if it's the last cue
// (or its cueIndex never recurs after a gap). Keyframes may include more
// than one entry per cue (word-level jump modes), so this only records the
// first transition to a *different* cueIndex.
function computeCueSupersedeTimes(keyframes, cueCount) {
  const supersede = new Array(cueCount).fill(Infinity);
  let prevCueIndex = null;
  for (const kf of keyframes) {
    if (prevCueIndex !== null && kf.cueIndex !== prevCueIndex && supersede[prevCueIndex] === Infinity) {
      supersede[prevCueIndex] = kf.time;
    }
    prevCueIndex = kf.cueIndex;
  }
  return supersede;
}

// Same idea, one level up: the time the active *row* (stacked mode's
// lineIndex) moves on to a different row. In flow mode every word shares
// lineIndex 0, so this never fires (Infinity for the single row) — flow-mode
// callers should use 'cue' granularity instead, see style.fadeOut.granularity.
function computeLineSupersedeTimes(keyframes, layoutCues) {
  const lineCount = layoutCues.reduce((max, c) => Math.max(max, c.lineIndex), 0) + 1;
  const supersede = new Array(lineCount).fill(Infinity);
  let prevLineIndex = null;
  for (const kf of keyframes) {
    const lineIndex = layoutCues[kf.cueIndex].lineIndex;
    if (prevLineIndex !== null && lineIndex !== prevLineIndex && supersede[prevLineIndex] === Infinity) {
      supersede[prevLineIndex] = kf.time;
    }
    prevLineIndex = lineIndex;
  }
  return supersede;
}

// Linear 0 (not started) -> 1 (fully complete) progress through
// [trigger+delay, trigger+delay+duration]. An infinite trigger (never
// superseded/ended) never starts.
function exitProgress(trigger, delay, duration, t) {
  if (!Number.isFinite(trigger)) return 0;
  const elapsed = t - trigger - (delay || 0);
  if (elapsed <= 0) return 0;
  const dur = Math.max(0.001, duration || 0.001);
  return Math.min(1, elapsed / dur);
}

// Screen-space offset/scale for a given exit progress and animation type.
// 'opacity' is alpha-only (identity transform) — the caller applies the
// alpha ramp itself, since fadeOut and cueExit blend opacity differently
// (fadeOut settles at inactiveOpacity, cueExit goes to fully hidden).
// No 'blur' type: keeping to alpha/translate/scale (already in the draw
// path) is what keeps the browser canvas and @napi-rs/canvas pixel-identical.
function exitOffset(progress, type, fontSize) {
  if (progress <= 0 || !type || type === 'none') return { dx: 0, dy: 0, scale: 1 };
  if (type === 'slide') return { dx: 0, dy: progress * fontSize * 0.8, scale: 1 };
  if (type === 'scale') return { dx: 0, dy: 0, scale: 1 - progress * 0.9 };
  return { dx: 0, dy: 0, scale: 1 }; // 'opacity'
}

module.exports = {
  computeCueSupersedeTimes, computeLineSupersedeTimes, exitProgress, exitOffset,
};
