const { fontString, computeLayout } = require('./layout');
const {
  buildKeyframes, cameraXAtTime, cameraYAtTime, cameraScaleAtTime, activeIndexAtTime,
} = require('./camera');
const { toCanvasFill } = require('./color');
const { sortMarkers, resolveConfigAt } = require('./configMarkers');
const {
  exitProgress, exitOffset, computeCueSupersedeTimes, computeLineSupersedeTimes,
} = require('./fade');

// Precomputes everything that doesn't depend on the playback time t: layout
// positions, camera keyframes, the time-sorted marker list drawFrame
// resolves local config (camera/colors/style) against, and the static
// "supersede" timestamps style.fadeOut animates from (see src/fade.js).
// Call once per (config, cues, markers, ctx).
function prepareScene(ctx, cues, config, markers = []) {
  ctx.font = fontString(config.font);
  const layout = computeLayout(ctx, cues, config.layout, config.font);
  const sortedMarkers = sortMarkers(markers);
  const keyframes = buildKeyframes(layout.cues, config, sortedMarkers);
  const cueSupersedeTime = computeCueSupersedeTimes(keyframes, layout.cues.length);
  const lineSupersedeTime = computeLineSupersedeTimes(keyframes, layout.cues);
  return {
    layout, keyframes, markers: sortedMarkers, cueSupersedeTime, lineSupersedeTime,
  };
}

// Pure per-frame draw: only reads from ctx, config and the precomputed
// scene — safe to call identically from a browser rAF loop or a Node CLI
// frame-stepping loop, since both talk to the same CanvasRenderingContext2D
// surface (native Canvas2D in-browser, @napi-rs/canvas in Node).
function drawFrame(ctx, { width, height }, config, scene, t) {
  const {
    layout, keyframes, markers = [], cueSupersedeTime = [], lineSupersedeTime = [],
  } = scene;

  // colors/style are resolved live at t (they don't affect the jump
  // animation, so there's no "mid-jump" case to worry about). camera is
  // resolved at the active jump's own start time instead of raw t, so a
  // marker landing inside an in-flight jump (config.camera.jumpDuration
  // window) can't change jumpDuration/easing/etc. mid-animation.
  const activeKeyframeIdx = activeIndexAtTime(keyframes, t);
  const cameraResolveTime = activeKeyframeIdx === -1 ? t : keyframes[activeKeyframeIdx].time;
  const resolvedNow = resolveConfigAt(config, markers, t);
  const resolvedCamera = (activeKeyframeIdx === -1
    ? resolvedNow
    : resolveConfigAt(config, markers, cameraResolveTime)).camera;

  const bgFill = toCanvasFill(resolvedNow.colors.background);
  ctx.clearRect(0, 0, width, height);
  if (bgFill) {
    ctx.fillStyle = bgFill;
    ctx.fillRect(0, 0, width, height);
  }

  const cameraX = cameraXAtTime(keyframes, t, resolvedCamera);
  const cameraY = cameraYAtTime(keyframes, t, resolvedCamera);
  const cameraScale = cameraScaleAtTime(keyframes, t, resolvedCamera);
  const activeCueIndex = activeKeyframeIdx === -1 ? -1 : keyframes[activeKeyframeIdx].cueIndex;
  const activeLineIndex = activeCueIndex !== -1 && layout.cues[activeCueIndex]
    ? layout.cues[activeCueIndex].lineIndex
    : 0;

  ctx.font = fontString(config.font);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const textFill = toCanvasFill(resolvedNow.colors.text) || 'rgba(0,0,0,1)';
  const inactiveOpacity = resolvedNow.style && resolvedNow.style.inactiveOpacity != null
    ? resolvedNow.style.inactiveOpacity
    : 0.35;
  const activeOpacity = resolvedNow.style && resolvedNow.style.activeOpacity != null
    ? resolvedNow.style.activeOpacity
    : 1;
  // Stacked mode only — in flow mode every word's lineIndex is 0, so these
  // never exclude anything (rowDelta is always 0, within [-1, 1] regardless).
  const showPrevLine = !config.layout || config.layout.showPrevLine !== false;
  const showNextLine = !config.layout || config.layout.showNextLine !== false;

  const centerX = width / 2;
  const centerY = height / 2;
  // Cull words that can't possibly be visible; a generous margin covers the
  // camera's overshoot bounce so nothing pops in mid-jump.
  const margin = width;
  const viewMinX = cameraX - centerX - margin;
  const viewMaxX = cameraX + centerX + margin;

  const cueExitCfg = resolvedNow.style && resolvedNow.style.cueExit;
  const cueExitType = cueExitCfg && cueExitCfg.type;
  const fadeOutCfg = resolvedNow.style && resolvedNow.style.fadeOut;
  const fadeOutType = fadeOutCfg && fadeOutCfg.type;
  const fadeOutGranularity = (fadeOutCfg && fadeOutCfg.granularity) || 'cue';

  ctx.fillStyle = textFill;
  ctx.save();
  // Zoom around the frame center, on the same jump timeline as the pan,
  // for a punch-in/punch-out feel on every cut (camera.zoom in config).
  ctx.translate(centerX, centerY);
  ctx.scale(cameraScale, cameraScale);
  ctx.translate(-centerX, -centerY);
  for (const word of layout.words) {
    if (word.x + word.width < viewMinX || word.x > viewMaxX) continue;
    const rowDelta = word.lineIndex - activeLineIndex;
    if (rowDelta < -1 || rowDelta > 1) continue;
    if (rowDelta === -1 && !showPrevLine) continue;
    if (rowDelta === 1 && !showNextLine) continue;
    let opacity = word.cueIndex === activeCueIndex ? activeOpacity : inactiveOpacity;
    let dx = 0;
    let dy = 0;
    let scale = 1;

    // fadeOut: for a word whose cue is no longer active, animates the
    // active->inactive opacity transition instead of snapping instantly.
    // The trigger time depends on granularity: 'cue' and 'word' both key off
    // when this word's own cue was superseded (word additionally staggers by
    // its position in the cue); 'line' keys off when this word's stacked row
    // was superseded, so the whole row fades together regardless of which of
    // its cues is which.
    if (word.cueIndex !== activeCueIndex && fadeOutType && fadeOutType !== 'none') {
      const trigger = fadeOutGranularity === 'line'
        ? lineSupersedeTime[word.lineIndex]
        : cueSupersedeTime[word.cueIndex]
          + (fadeOutGranularity === 'word' ? word.wordIndex * (fadeOutCfg.wordStagger || 0) : 0);
      const progress = exitProgress(trigger, fadeOutCfg.delay, fadeOutCfg.duration, t);
      opacity = activeOpacity + (inactiveOpacity - activeOpacity) * progress;
      const off = exitOffset(progress, fadeOutType, config.font.size);
      dx += off.dx;
      dy += off.dy;
      scale *= off.scale;
    }

    // cueExit: fades this word fully out once its own cue has ended (plus
    // delay), regardless of active/inactive state — this is what makes text
    // actually leave the screen during a gap instead of sitting at
    // activeOpacity until the next cue's jump fires.
    if (cueExitType && cueExitType !== 'none') {
      const cueEnd = layout.cues[word.cueIndex].end;
      const progress = exitProgress(cueEnd, cueExitCfg.delay, cueExitCfg.duration, t);
      if (progress >= 1) continue;
      opacity *= (1 - progress);
      const off = exitOffset(progress, cueExitType, config.font.size);
      dx += off.dx;
      dy += off.dy;
      scale *= off.scale;
    }

    if (opacity <= 0) continue;
    const screenX = word.x - cameraX + centerX;
    const screenY = word.y - cameraY + centerY;
    ctx.globalAlpha = opacity;
    if (dx !== 0 || dy !== 0 || scale !== 1) {
      const wcx = screenX + word.width / 2 + dx;
      const wcy = screenY + dy;
      ctx.save();
      ctx.translate(wcx, wcy);
      ctx.scale(scale, scale);
      ctx.translate(-wcx, -wcy);
      ctx.fillText(word.text, screenX + dx, screenY + dy);
      ctx.restore();
    } else {
      ctx.fillText(word.text, screenX, screenY);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

module.exports = { prepareScene, drawFrame };
