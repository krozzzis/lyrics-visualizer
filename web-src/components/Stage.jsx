import { createSignal, createEffect, onMount } from 'solid-js';
import * as sceneMod from '../../src/scene.js';

const { prepareScene, drawFrame } = sceneMod;

// Renders the lyric canvas using the exact same drawFrame() the CLI renderer
// calls — that shared code is what keeps this preview pixel-identical to
// the ffmpeg render at the same t.
//
// props.config and props.markers are reactive Solid stores: the settings
// panel edits config live, and the timeline's marker row edits markers
// (add/move/delete/override). prepareScene() re-runs automatically whenever
// a field it actually reads (font.*, layout.*, camera.anchor, word.splitMode)
// changes, since Solid's store proxy tracks property access no matter how
// deep the call stack is inside prepareScene/computeLayout/buildKeyframes.
//
// markers needs an explicit read of every element's time/overrides (same
// pattern as Timeline.jsx's cues.forEach(... void cue.start ...)): replacing
// a marker's `overrides` wholesale (see Player.jsx's setMarkerOverride) is a
// single-key store write, but this effect only reaches that key through a
// `[...markers].sort()` copy inside prepareScene → buildKeyframes →
// resolveConfigAt, one indirection too many for Solid to have reliably
// tracked it from here on the previous run — verified empirically: without
// this, toggling a marker's camera.anchor override left the canvas
// byte-identical (buildKeyframes bakes anchor into keyframes[].x once, so
// unlike jumpDuration/colors/style — re-resolved fresh every drawFrame() tick
// regardless of Solid tracking — a missed re-run here shows up as a frozen
// preview, not just a delayed one).
export default function Stage(props) {
  let canvasEl;
  const [ctx, setCtx] = createSignal(null);

  onMount(async () => {
    const face = new FontFace(props.config.font.family, `url(${props.config.font.url})`);
    await face.load();
    document.fonts.add(face);
    setCtx(canvasEl.getContext('2d'));
  });

  // Canvas pixel size follows config.output.width/height independently of
  // the layout recompute below — resizing doesn't need a new scene.
  createEffect(() => {
    if (!canvasEl) return;
    canvasEl.width = props.config.output.width;
    canvasEl.height = props.config.output.height;
  });

  createEffect(() => {
    const c = ctx();
    if (!c) return;
    const markers = props.markers || [];
    markers.forEach((m) => { void m.time; void m.overrides; });
    const scene = prepareScene(c, props.cues, props.config, markers);
    props.onReady({ ctx: c, scene });
  });

  return (
    <div id="stage">
      <canvas id="canvas" ref={canvasEl} />
    </div>
  );
}

export { drawFrame };
