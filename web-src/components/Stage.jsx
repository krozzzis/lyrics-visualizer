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
// a field it actually reads (font.*, layout.*, camera.anchor, word.splitMode,
// every marker's time/overrides) changes, since Solid's store proxy tracks
// property access no matter how deep the call stack is inside
// prepareScene/computeLayout/buildKeyframes — including through the
// `[...markers].sort()` copy inside buildKeyframes/resolveConfigAt. Verified
// by toggling a marker's camera.anchor override and diffing canvas.toDataURL()
// before/after with no reload: camera.anchor is the one marker field that
// would show a *frozen* preview (not just a stale one) on a missed
// re-run, since buildKeyframes bakes it into keyframes[].x once here, unlike
// jumpDuration/colors/style, which resolve fresh every drawFrame() tick
// regardless of whether this effect reran.
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
    const scene = prepareScene(c, props.cues, props.config, props.markers || []);
    props.onReady({ ctx: c, scene });
  });

  return (
    <div id="stage">
      <canvas id="canvas" ref={canvasEl} />
    </div>
  );
}

export { drawFrame };
