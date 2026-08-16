const { fontString, computeLayout } = require('./layout');
const {
  buildKeyframes, cameraXAtTime, cameraYAtTime, cameraScaleAtTime, activeIndexAtTime,
} = require('./camera');
const { toCanvasFill } = require('./color');

// Precomputes everything that doesn't depend on the playback time t:
// layout positions and camera keyframes. Call once per (config, cues, ctx).
function prepareScene(ctx, cues, config) {
  ctx.font = fontString(config.font);
  const layout = computeLayout(ctx, cues, config.layout, config.font);
  const keyframes = buildKeyframes(layout.cues, config);
  return { layout, keyframes };
}

// Pure per-frame draw: only reads from ctx, config and the precomputed
// scene — safe to call identically from a browser rAF loop or a Node CLI
// frame-stepping loop, since both talk to the same CanvasRenderingContext2D
// surface (native Canvas2D in-browser, @napi-rs/canvas in Node).
function drawFrame(ctx, { width, height }, config, scene, t) {
  const { layout, keyframes } = scene;

  const bgFill = toCanvasFill(config.colors.background);
  ctx.clearRect(0, 0, width, height);
  if (bgFill) {
    ctx.fillStyle = bgFill;
    ctx.fillRect(0, 0, width, height);
  }

  const cameraX = cameraXAtTime(keyframes, t, config.camera);
  const cameraY = cameraYAtTime(keyframes, t, config.camera);
  const cameraScale = cameraScaleAtTime(keyframes, t, config.camera);
  const activeKeyframeIdx = activeIndexAtTime(keyframes, t);
  const activeCueIndex = activeKeyframeIdx === -1 ? -1 : keyframes[activeKeyframeIdx].cueIndex;
  const activeLineIndex = activeCueIndex !== -1 && layout.cues[activeCueIndex]
    ? layout.cues[activeCueIndex].lineIndex
    : 0;

  ctx.font = fontString(config.font);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const textFill = toCanvasFill(config.colors.text) || 'rgba(0,0,0,1)';
  const inactiveOpacity = config.style && config.style.inactiveOpacity != null
    ? config.style.inactiveOpacity
    : 0.35;
  const activeOpacity = config.style && config.style.activeOpacity != null
    ? config.style.activeOpacity
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
    const screenX = word.x - cameraX + centerX;
    const screenY = word.y - cameraY + centerY;
    const opacity = word.cueIndex === activeCueIndex ? activeOpacity : inactiveOpacity;
    if (opacity <= 0) continue;
    ctx.globalAlpha = opacity;
    ctx.fillText(word.text, screenX, screenY);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

module.exports = { prepareScene, drawFrame };
