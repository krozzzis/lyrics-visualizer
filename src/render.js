const path = require('path');
const { spawn } = require('child_process');
const { createCanvas } = require('@napi-rs/canvas');

const { prepareScene, drawFrame } = require('./scene');
const { registerConfigFont } = require('./node-font');
const { alphaOf } = require('./color');
const { backgroundNeedsAlpha } = require('./configMarkers');

// Shared by the CLI renderer (bin/render.js) and the dev server's /api/render
// so both produce byte-identical output from the same drawFrame() call the
// browser preview uses.

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

function buildFfmpegArgs(config, markers, outPath, fps) {
  // Checked across the base config *and* every marker's colors.background
  // override, not just the base: a marker can make the background
  // translucent partway through, and the container/codec has to be able to
  // carry that from the first frame — it can't change mid-file.
  const wantsAlpha = backgroundNeedsAlpha(config, markers, alphaOf);
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

// Renders cues under config to outPath, calling onProgress after each frame.
// Resolves once ffmpeg has fully written the file; rejects (without hanging)
// if ffmpeg/ffprobe can't be spawned or exits non-zero.
async function renderVideo(config, cues, outPath, opts = {}) {
  const {
    start = 0, duration: explicitDuration, onProgress, markers = [],
  } = opts;

  registerConfigFont(config);
  const canvas = createCanvas(config.output.width, config.output.height);
  const ctx = canvas.getContext('2d');
  const scene = prepareScene(ctx, cues, config, markers);

  const fps = config.output.fps;
  const duration = await resolveDuration(config, cues, explicitDuration);
  const frameCount = Math.max(0, Math.ceil((duration - start) * fps));

  const ffArgs = buildFfmpegArgs(config, markers, outPath, fps);
  const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  // A dead stdin (process never spawned, or died mid-render) otherwise
  // raises an unhandled EPIPE 'error' on the stream and crashes the server;
  // failures are surfaced through ffExit below instead.
  ff.stdin.on('error', () => {});

  const ffExit = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
  });
  // Keep this settled-but-unobserved rejection from logging an unhandled-
  // rejection warning if frameCount is 0 and nothing else awaits it.
  ffExit.catch(() => {});

  async function writeFrame(buf) {
    const ok = ff.stdin.write(buf);
    if (!ok) {
      // Race the backpressure wait against the process exiting/erroring —
      // a dead ffmpeg (e.g. not on PATH) otherwise leaves this awaiting a
      // 'drain' that will never come, hanging the render forever.
      await Promise.race([
        new Promise((resolve) => { ff.stdin.once('drain', resolve); }),
        ffExit,
      ]);
    }
  }

  for (let i = 0; i < frameCount; i += 1) {
    const t = start + i / fps;
    drawFrame(ctx, config.output, config, scene, t);
    await writeFrame(canvas.toBuffer('image/png'));
    if (onProgress) onProgress({ frame: i + 1, frameCount, t, duration });
    // Yield to the event loop every frame: canvas encode + pipe writes are
    // otherwise back-to-back synchronous/microtask work that can starve
    // other requests (like a progress-poll endpoint) for the whole render.
    await new Promise((resolve) => { setImmediate(resolve); });
  }
  ff.stdin.end();
  await ffExit;
  return { outPath, frameCount, duration };
}

module.exports = {
  renderVideo, resolveDuration, buildFfmpegArgs, ffprobeDuration,
};
