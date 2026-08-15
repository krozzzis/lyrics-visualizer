#!/usr/bin/env node
const fs = require('fs');
const { Command } = require('commander');
const { createCanvas } = require('@napi-rs/canvas');

const { loadConfig } = require('../src/config');
const { loadSubtitles } = require('../src/subtitles');
const { loadCues } = require('../src/cues');
const { prepareScene, drawFrame } = require('../src/scene');
const { registerConfigFont } = require('../src/node-font');
const { renderVideo } = require('../src/render');
const { ensureNativeSubtitle } = require('../src/convertSubtitle');

function buildScene(config) {
  registerConfigFont(config);
  const cues = loadCues(config);

  const canvas = createCanvas(config.output.width, config.output.height);
  const ctx = canvas.getContext('2d');
  const scene = prepareScene(ctx, cues, config);
  return { canvas, ctx, scene, cues };
}

async function cmdDump(opts) {
  ensureNativeSubtitle(opts.config);
  const config = loadConfig(opts.config);
  const cues = loadSubtitles(config.subtitle);
  console.log(JSON.stringify(cues, null, 2));
}

async function cmdFrame(opts) {
  ensureNativeSubtitle(opts.config);
  const config = loadConfig(opts.config);
  const { canvas, ctx, scene } = buildScene(config);
  drawFrame(ctx, config.output, config, scene, parseFloat(opts.time));
  fs.writeFileSync(opts.out, canvas.toBuffer('image/png'));
  console.log(`Wrote ${opts.out}`);
}

async function cmdVideo(opts) {
  ensureNativeSubtitle(opts.config);
  const config = loadConfig(opts.config);
  const cues = loadCues(config);
  const start = parseFloat(opts.start);
  const explicitDuration = opts.duration ? parseFloat(opts.duration) : undefined;

  await renderVideo(config, cues, opts.out, {
    start,
    duration: explicitDuration,
    onProgress: ({ frame, t, duration }) => {
      if ((frame - 1) % config.output.fps === 0) {
        process.stderr.write(`\rrendering ${t.toFixed(1)}s / ${duration.toFixed(1)}s`);
      }
    },
  });
  process.stderr.write('\n');
  console.log(`Wrote ${opts.out}`);
}

const program = new Command();
program.name('lyrics-visualizer').description('Single-line lyric video renderer');

program.command('dump')
  .description('Parse the configured subtitle file and print cues as JSON')
  .requiredOption('-c, --config <path>', 'path to config.yaml')
  .action(cmdDump);

program.command('frame')
  .description('Render a single PNG frame at time t (seconds)')
  .requiredOption('-c, --config <path>', 'path to config.yaml')
  .requiredOption('-t, --time <seconds>', 'playback time to render')
  .option('-o, --out <path>', 'output PNG path', 'frame.png')
  .action(cmdFrame);

program.command('video')
  .description('Render the full video and pipe frames to ffmpeg')
  .requiredOption('-c, --config <path>', 'path to config.yaml')
  .requiredOption('-o, --out <path>', 'output video path (.mp4/.mov/.webm)')
  .option('--duration <seconds>', 'override total duration')
  .option('--start <seconds>', 'start time', '0')
  .action(cmdVideo);

program.parseAsync(process.argv).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
