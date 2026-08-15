import { onMount } from 'solid-js';
import * as sceneMod from '../../src/scene.js';

const { prepareScene, drawFrame } = sceneMod;

// Renders the lyric canvas using the exact same drawFrame() the CLI renderer
// calls — that shared code is what keeps this preview pixel-identical to
// the ffmpeg render at the same t.
export default function Stage(props) {
  let canvasEl;

  onMount(async () => {
    const { config, cues } = props;
    canvasEl.width = config.output.width;
    canvasEl.height = config.output.height;

    const face = new FontFace(config.font.family, `url(${config.font.url})`);
    await face.load();
    document.fonts.add(face);

    const ctx = canvasEl.getContext('2d');
    const scene = prepareScene(ctx, cues, config);
    props.onReady({ ctx, scene });
  });

  return (
    <div id="stage">
      <canvas id="canvas" ref={canvasEl} />
    </div>
  );
}

export { drawFrame };
