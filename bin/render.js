#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Command } = require('commander');
const { createCanvas } = require('@napi-rs/canvas');

const { loadConfig } = require('../src/config');
const { loadSubtitles } = require('../src/subtitles');
const { loadCues } = require('../src/cues');
const { prepareScene, drawFrame } = require('../src/scene');
const { registerConfigFont } = require('../src/node-font');
const { alphaOf } = require('../src/color');

function buildScene(config) {
  registerConfigFont(config);
  const cues = loadCues(config);

  const canvas = createCanvas(config.output.width, config.output.height);
  const ctx = canvas.getContext('2d');
  const scene = prepareScene(ctx, cues, config);
  return { canvas, ctx, scene, cues };
}

function ffprobeDuration(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ]);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed for ${file}: ${err}`));
      return resolve(parseFloat(out.trim()));
    });
  });
}

async function resolveDuration(config, cues, explicitDuration) {
  if (explicitDuration) return explicitDuration;
  if (config.output.duration) return config.output.duration;
  if (config.audio) return ffprobeDuration(config.audio);
  const lastEnd = cues.length ? cues[cues.length - 1].end : 0;
  return lastEnd + 2;
}

function buildFfmpegArgs(config, outPath, fps) {
  const bgAlpha = alphaOf(config.colors.background);
  const wantsAlpha = bgAlpha < 1;
  const ext = path.extname(outPath).toLowerCase();

  // .webm (VP9) alpha is deliberately not offered: it round-trips through
  // this project's ffmpeg/libvpx-vp9 build as fully opaque (verified by
  // encoding a known-transparent PNG and decoding it back) — a silent
  // correctness bug rather than a working feature. ProRes 4444/.mov is the
  // one alpha path actually verified to preserve alpha end-to-end.
  if (wantsAlpha && ext !== '.mov') {
    throw new Error(
      `Config background is transparent/translucent but output is ${ext || '(no extension)'}. `
      + 'Use a .mov output path (ProRes 4444, verified to preserve alpha), or set colors.background to an opaque color.',
    );
  }

  const args = ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
  if (config.audio) args.push('-i', config.audio);

  if (wantsAlpha) {
    args.push('-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le');
  } else {
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  }

  if (config.audio) {
    args.push('-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-shortest');
  }

  args.push(outPath);
  return args;
}

async function writeFrame(ff, buf) {
  const ok = ff.stdin.write(buf);
  if (!ok) await new Promise((resolve) => ff.stdin.once('drain', resolve));
}

async function cmdDump(opts) {
  const config = loadConfig(opts.config);
  const cues = loadSubtitles(config.subtitle);
  console.log(JSON.stringify(cues, null, 2));
}

async function cmdFrame(opts) {
  const config = loadConfig(opts.config);
  const { canvas, ctx, scene } = buildScene(config);
  drawFrame(ctx, config.output, config, scene, parseFloat(opts.time));
  fs.writeFileSync(opts.out, canvas.toBuffer('image/png'));
  console.log(`Wrote ${opts.out}`);
}

async function cmdVideo(opts) {
  const config = loadConfig(opts.config);
  const { canvas, ctx, scene, cues } = buildScene(config);
  const fps = config.output.fps;
  const start = parseFloat(opts.start);
  const duration = await resolveDuration(config, cues, opts.duration && parseFloat(opts.duration));
  const frameCount = Math.max(0, Math.ceil((duration - start) * fps));

  const ffArgs = buildFfmpegArgs(config, opts.out, fps);
  const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffExit = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
  });

  for (let i = 0; i < frameCount; i += 1) {
    const t = start + i / fps;
    drawFrame(ctx, config.output, config, scene, t);
    await writeFrame(ff, canvas.toBuffer('image/png'));
    if (i % fps === 0) {
      process.stderr.write(`\rrendering ${t.toFixed(1)}s / ${duration.toFixed(1)}s`);
    }
  }
  ff.stdin.end();
  await ffExit;
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
