import { createSignal, createEffect, onMount } from 'solid-js';
import * as sceneMod from '../../src/scene.js';

const { prepareScene, drawFrame } = sceneMod;

// Renders the lyric canvas using the exact same drawFrame() the CLI renderer
// calls — that shared code is what keeps this preview pixel-identical to
// the ffmpeg render at the same t.
//
// props.config is a reactive Solid store: the settings panel can edit it
// live. prepareScene() re-runs automatically whenever a field it actually
// reads (font.*, layout.*, camera.anchor, word.splitMode) changes, since
// Solid's store proxy tracks property access no matter how deep the call
// stack is inside prepareScene/computeLayout/buildKeyframes.
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
    const scene = prepareScene(c, props.cues, props.config);
    props.onReady({ ctx: c, scene });
  });

  return (
    <div id="stage">
      <canvas id="canvas" ref={canvasEl} />
    </div>
  );
}

export { drawFrame };
