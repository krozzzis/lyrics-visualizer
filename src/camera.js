const { resolveConfigAt } = require('./configMarkers');

// Builds camera jump keyframes from laid-out cues, and interpolates the
// camera's X position and zoom scale at an arbitrary time with an
// easing/overshoot curve.
//
// Default granularity is line-level: one jump per cue, exactly on its start
// time from the subtitle file. Word-level jumps only happen when genuine
// per-word timing exists (ASS karaoke tags) or the user explicitly opts into
// synthesized char-weighted timing via config.word.splitMode.

// sortedMarkers (time-sorted, see configMarkers.sortMarkers) lets
// camera.anchor change partway through the timeline: each cue resolves its
// own anchor at its start time, so cues before a marker keep the old anchor
// and cues from the marker onward pick up the new one.
function buildKeyframes(layoutCues, config, sortedMarkers = []) {
  const mode = (config.word && config.word.splitMode) || 'line';
  const keyframes = [];

  for (const cue of layoutCues) {
    const hasWordTiming = mode !== 'line'
      && cue.words.length > 0
      && cue.words.every((w) => typeof w.start === 'number');

    if (hasWordTiming) {
      for (const w of cue.words) {
        keyframes.push({
          time: w.start, x: w.x + w.width / 2, y: w.y, cueIndex: cue.cueIndex,
        });
      }
    } else {
      const resolvedCamera = resolveConfigAt(config, sortedMarkers, cue.start).camera || {};
      const anchor = resolvedCamera.anchor || 'center';
      const first = cue.words[0];
      const anchorX = anchor === 'start'
        ? (first ? first.x + first.width / 2 : cue.startX)
        : cue.centerX;
      keyframes.push({
        time: cue.start, x: anchorX, y: cue.y, cueIndex: cue.cueIndex,
      });
    }
  }

  keyframes.sort((a, b) => a.time - b.time);
  return keyframes;
}

function easeOutBack(p, overshoot) {
  const c1 = overshoot;
  const c3 = c1 + 1;
  const x = p - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

function easeOutQuad(p) {
  return 1 - (1 - p) * (1 - p);
}

function easeSpring(p, overshoot) {
  const decay = 6;
  const freq = Math.max(0, overshoot) * 5;
  return 1 - Math.exp(-decay * p) * Math.cos(freq * p);
}

function applyEasing(p, cameraConfig) {
  const easing = cameraConfig.easing || 'easeOutBack';
  if (easing === 'linear') return p;
  if (easing === 'spring') return easeSpring(p, cameraConfig.overshoot ?? 1.2);
  return easeOutBack(p, cameraConfig.overshoot ?? 1.7);
}

// Index of the keyframe (== cue, for line-mode) active at time t, or -1.
function activeIndexAtTime(keyframes, t) {
  let idx = -1;
  for (let i = 0; i < keyframes.length; i += 1) {
    if (keyframes[i].time <= t) idx = i;
    else break;
  }
  return idx;
}

// Eased 0→1 progress through the jump that's active (or most recently
// landed) at time t. Shared by position and zoom so both animate on the
// same timeline — 1 before the first cue and once a jump has settled.
function jumpProgress(keyframes, t, cameraConfig) {
  const idx = activeIndexAtTime(keyframes, t);
  if (idx === -1) return 1;
  const to = keyframes[idx];
  const dur = Math.max(0.001, cameraConfig.jumpDuration ?? 0.22);
  const elapsed = t - to.time;
  if (elapsed >= dur) return 1;
  return applyEasing(elapsed / dur, cameraConfig);
}

// Returns the camera's target X at time t, animating each jump over
// cameraConfig.jumpDuration seconds starting at the keyframe's time.
function cameraXAtTime(keyframes, t, cameraConfig) {
  if (keyframes.length === 0) return 0;

  const idx = activeIndexAtTime(keyframes, t);
  if (idx === -1) return keyframes[0].x;

  const to = keyframes[idx];
  const from = idx > 0 ? keyframes[idx - 1] : to;
  if (from.x === to.x) return to.x;

  const eased = jumpProgress(keyframes, t, cameraConfig);
  return from.x + (to.x - from.x) * eased;
}

// Returns the camera's target Y at time t — same shape as cameraXAtTime.
// In flow mode every keyframe's y is 0, so this is always 0 (from.y === to.y
// short-circuits before any easing math runs). In stacked mode, keyframes
// within the same logical line share their row's y, so the camera only
// actually moves vertically — with the same jump/ease curve as X — on a
// transition to a different line, never mid-line.
function cameraYAtTime(keyframes, t, cameraConfig) {
  if (keyframes.length === 0) return 0;

  const idx = activeIndexAtTime(keyframes, t);
  if (idx === -1) return keyframes[0].y;

  const to = keyframes[idx];
  const from = idx > 0 ? keyframes[idx - 1] : to;
  if (from.y === to.y) return to.y;

  const eased = jumpProgress(keyframes, t, cameraConfig);
  return from.y + (to.y - from.y) * eased;
}

// Returns the camera's zoom scale at time t: a genuine two-phase punch on
// every jump — scale first pulls OUT from 1 down to zoom.amount over the
// first zoom.outFraction of the jump, then eases back IN to 1 (with the
// same overshoot/settle feel as the pan) over the rest. Disabled (flat 1)
// unless camera.zoom.enabled.
function cameraScaleAtTime(keyframes, t, cameraConfig) {
  const zoom = cameraConfig && cameraConfig.zoom;
  if (!zoom || zoom.enabled === false || keyframes.length === 0) return 1;

  const idx = activeIndexAtTime(keyframes, t);
  if (idx === -1) return 1;
  const to = keyframes[idx];
  const dur = Math.max(0.001, cameraConfig.jumpDuration ?? 0.22);
  const elapsed = t - to.time;
  if (elapsed >= dur) return 1;

  const amount = zoom.amount ?? 0.88; // trough scale at the peak of the pull-back
  const outFraction = Math.min(0.9, Math.max(0.05, zoom.outFraction ?? 0.35));
  const p = elapsed / dur;

  if (p <= outFraction) {
    // Zoom OUT: 1 -> amount, quick and decisive.
    const eased = easeOutQuad(p / outFraction);
    return 1 + (amount - 1) * eased;
  }
  // Zoom IN: amount -> 1, snapping back with the configured overshoot.
  const eased = applyEasing((p - outFraction) / (1 - outFraction), cameraConfig);
  return amount + (1 - amount) * eased;
}

module.exports = {
  buildKeyframes, cameraXAtTime, cameraYAtTime, cameraScaleAtTime, activeIndexAtTime,
};
