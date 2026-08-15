const { fontString, computeLayout } = require('./layout');
const {
  buildKeyframes, cameraXAtTime, cameraScaleAtTime, activeIndexAtTime,
} = require('./camera');
const { toCanvasFill } = require('./color');

// Precomputes everything that doesn't depend on the playback time t:
// layout positions and camera keyframes. Call once per (config, cues, ctx).
function prepareScene(ctx, cues, config) {
  ctx.font = fontString(config.font);
  const layout = computeLayout(ctx, cues, config.layout);
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
  const cameraScale = cameraScaleAtTime(keyframes, t, config.camera);
  const activeKeyframeIdx = activeIndexAtTime(keyframes, t);
  const activeCueIndex = activeKeyframeIdx === -1 ? -1 : keyframes[activeKeyframeIdx].cueIndex;

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
    const screenX = word.x - cameraX + centerX;
    const opacity = word.cueIndex === activeCueIndex ? activeOpacity : inactiveOpacity;
    if (opacity <= 0) continue;
    ctx.globalAlpha = opacity;
    ctx.fillText(word.text, screenX, centerY);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

module.exports = { prepareScene, drawFrame };
