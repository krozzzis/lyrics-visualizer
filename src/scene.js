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
// resolves local config (camera/colors/style) against, the static
// "supersede" timestamps style.fadeOut animates from (see src/fade.js), and
// each cue's own resolved text color/opacity/exit style (see perCueStyle
// below). Call once per (config, cues, markers, ctx).
function prepareScene(ctx, cues, config, markers = []) {
  ctx.font = fontString(config.font);
  const sortedMarkers = sortMarkers(markers);
  const layout = computeLayout(ctx, cues, config, sortedMarkers, config.font);
  const keyframes = buildKeyframes(layout.cues, config, sortedMarkers);
  const cueSupersedeTime = computeCueSupersedeTimes(keyframes, layout.cues.length);
  const lineSupersedeTime = computeLineSupersedeTimes(keyframes, layout.cues);
  // A marker's colors/style/layout overrides are about which *cues* they
  // paint, not which frames — a marker crossed mid-screen (e.g. while the
  // previous line is still visible via layout.showPrevLine, or fading out
  // via style.fadeOut/cueExit) must not repaint that older cue. So each cue
  // resolves its own text color/opacity/exit style/row-visibility once, at
  // its own start time, the same way buildKeyframes resolves camera.anchor
  // per-cue above — not live against the playhead like colors.background
  // (one value per frame, so it has no "owning cue" to pin to) still is in
  // drawFrame. wordGap/cueGap/lineHeight/nextLineFrom/mode are resolved
  // separately, inside computeLayout itself, since they shape word
  // *positions* rather than how an already-positioned word is painted.
  const perCueStyle = layout.cues.map((cue) => {
    const resolved = resolveConfigAt(config, sortedMarkers, cue.start);
    const style = resolved.style || {};
    const layoutCfg = resolved.layout || {};
    return {
      textFill: toCanvasFill(resolved.colors.text) || 'rgba(0,0,0,1)',
      activeOpacity: style.activeOpacity != null ? style.activeOpacity : 1,
      inactiveOpacity: style.inactiveOpacity != null ? style.inactiveOpacity : 0.35,
      cueExitCfg: style.cueExit,
      fadeOutCfg: style.fadeOut,
      showPrevLine: layoutCfg.showPrevLine !== false,
      showNextLine: layoutCfg.showNextLine !== false,
    };
  });
  return {
    layout, keyframes, markers: sortedMarkers, cueSupersedeTime, lineSupersedeTime, perCueStyle,
  };
}

// Pure per-frame draw: only reads from ctx, config and the precomputed
// scene — safe to call identically from a browser rAF loop or a Node CLI
// frame-stepping loop, since both talk to the same CanvasRenderingContext2D
// surface (native Canvas2D in-browser, @napi-rs/canvas in Node).
function drawFrame(ctx, { width, height }, config, scene, t) {
  const {
    layout, keyframes, markers = [], cueSupersedeTime = [], lineSupersedeTime = [], perCueStyle = [],
  } = scene;

  // colors.background is resolved live at t: it's one value for the whole
  // frame, not owned by any particular cue, so a marker flips it exactly
  // when the playhead crosses it. Every other colors/style field is owned by
  // whichever cue it paints — see perCueStyle in prepareScene — precisely so
  // a marker crossed mid-screen can't repaint a cue that isn't "next" yet.
  // camera is resolved at the active jump's own start time instead of raw t,
  // so a marker landing inside an in-flight jump (config.camera.jumpDuration
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

  const defaultCueStyle = {
    textFill: 'rgba(0,0,0,1)',
    activeOpacity: 1,
    inactiveOpacity: 0.35,
    cueExitCfg: undefined,
    fadeOutCfg: undefined,
    showPrevLine: true,
    showNextLine: true,
  };
  // Stacked mode only — in flow mode every word's lineIndex is 0, so these
  // never exclude anything (rowDelta is always 0, within [-1, 1] regardless).
  // Read off the *active* cue's own resolved layout — it describes what the
  // active row shows around itself, so (unlike wordGap/cueGap/etc., which
  // are baked into word positions once in computeLayout) this one field
  // still needs a per-frame lookup, keyed by whichever cue is active now.
  const activeRowStyle = activeCueIndex !== -1 ? (perCueStyle[activeCueIndex] || defaultCueStyle) : defaultCueStyle;
  const { showPrevLine, showNextLine } = activeRowStyle;

  const centerX = width / 2;
  const centerY = height / 2;
  // Cull words that can't possibly be visible; a generous margin covers the
  // camera's overshoot bounce so nothing pops in mid-jump.
  const margin = width;
  const viewMinX = cameraX - centerX - margin;
  const viewMaxX = cameraX + centerX + margin;

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
    // Every field below comes from the word's own cue's resolved style
    // (perCueStyle[word.cueIndex], pinned at that cue's start time) rather
    // than "now" — a marker crossed while this word is still on screen
    // (inactive, fading out, or mid-cueExit) must not repaint it.
    const cueStyle = perCueStyle[word.cueIndex] || defaultCueStyle;
    const { cueExitCfg, fadeOutCfg } = cueStyle;
    const cueExitType = cueExitCfg && cueExitCfg.type;
    const fadeOutType = fadeOutCfg && fadeOutCfg.type;
    const fadeOutGranularity = (fadeOutCfg && fadeOutCfg.granularity) || 'cue';
    let opacity = word.cueIndex === activeCueIndex ? cueStyle.activeOpacity : cueStyle.inactiveOpacity;
    let dx = 0;
    let dy = 0;
    let scale = 1;

    // fadeOut: other cues in the active line, and previous lines, are
    // already dimmed to inactiveOpacity immediately by the ternary above —
    // that's the default, unanimated state. fadeOut only comes in later: it
    // fades that resting inactiveOpacity down to fully hidden once the word
    // has been superseded for a while, so it's the animation that removes
    // old content rather than the thing that dims it. The trigger time
    // depends on granularity: 'cue' and 'word' both key off when this
    // word's own cue was superseded (word additionally staggers by its
    // position in the cue); 'line' keys off when this word's stacked row
    // was superseded, so the whole row disappears together regardless of
    // which of its cues is which.
    if (word.cueIndex !== activeCueIndex && fadeOutType && fadeOutType !== 'none'
      && t >= cueSupersedeTime[word.cueIndex]) {
      const trigger = fadeOutGranularity === 'line'
        ? lineSupersedeTime[word.lineIndex]
        : cueSupersedeTime[word.cueIndex]
          + (fadeOutGranularity === 'word' ? word.wordIndex * (fadeOutCfg.wordStagger || 0) : 0);
      const progress = exitProgress(trigger, fadeOutCfg.delay, fadeOutCfg.duration, t);
      if (progress >= 1) continue;
      opacity *= (1 - progress);
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
    ctx.fillStyle = cueStyle.textFill;
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
