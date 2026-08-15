#!/usr/bin/env node
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const yaml = require('js-yaml');
const { Command } = require('commander');

const { loadConfig, deepMerge } = require('../src/config');
const { loadCues } = require('../src/cues');
const { renderVideo } = require('../src/render');
const { alphaOf } = require('../src/color');

const program = new Command();
program
  .requiredOption('-c, --config <path>', 'path to config.yaml')
  .option('-p, --port <n>', 'port to listen on', '8080')
  .parse(process.argv);

const opts = program.opts();
let config = loadConfig(opts.config);
let cues = loadCues(config);

const distDir = path.join(__dirname, '..', 'web', 'dist');
if (!fs.existsSync(distDir)) {
  console.error(`${distDir} not found — run 'npm run build' first.`);
  process.exit(1);
}

const app = express();
app.use(express.static(distDir));
app.use(express.json());

// Public config: same shape the renderer uses, but with server filesystem
// paths swapped for URLs the browser can fetch.
app.get('/api/data', (req, res) => {
  const publicConfig = {
    font: { family: config.font.family, size: config.font.size, weight: config.font.weight, style: config.font.style, url: '/assets/font' },
    colors: config.colors,
    output: config.output,
    camera: config.camera,
    word: config.word,
    layout: config.layout,
    style: config.style,
    timeline: config.timeline,
    audio: config.audio ? '/assets/audio' : null,
  };
  res.json({ config: publicConfig, cues });
});

// Persists settings-panel edits back to the config file this server was
// started with. Only a fixed whitelist of fields is accepted — never
// subtitle/audio/font.path — and they're deep-merged onto a fresh read of
// the file's own current YAML rather than the fully-defaulted in-memory
// `config`, so untouched fields (including ones this app doesn't manage)
// survive. Comments in the file do not: js-yaml's dump() can't preserve them.
const EDITABLE_KEYS = ['output', 'colors', 'font', 'camera', 'word', 'layout', 'style', 'timeline'];
const EDITABLE_FONT_KEYS = ['size', 'weight', 'style'];

function filterEditable(body) {
  const editable = {};
  for (const key of EDITABLE_KEYS) {
    if (body[key] !== undefined) editable[key] = body[key];
  }
  if (editable.font) {
    const filteredFont = {};
    for (const key of EDITABLE_FONT_KEYS) {
      if (editable.font[key] !== undefined) filteredFont[key] = editable.font[key];
    }
    editable.font = filteredFont;
  }
  return editable;
}

app.post('/api/config', (req, res) => {
  try {
    const editable = filterEditable(req.body || {});

    const raw = fs.readFileSync(opts.config, 'utf8');
    const parsed = yaml.load(raw) || {};
    const merged = deepMerge(parsed, editable);
    fs.writeFileSync(opts.config, yaml.dump(merged, { lineWidth: 100 }), 'utf8');

    // Keep this process's in-memory config/cues in sync with what was just
    // written — otherwise GET /api/data (a page reload, a new tab) keeps
    // serving the values this server started with, making saved edits look
    // like they never applied or never persisted.
    config = loadConfig(opts.config);
    cues = loadCues(config);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Full video render, run in-process and downloaded when done. Only one job
// at a time — this is a single-user local dev tool, not a render farm.
//
// Takes the same whitelisted fields as /api/config, but merges them onto the
// full in-memory `config` for this render only, without touching the file:
// the settings panel can have live unsaved edits (font size dragged, zoom
// toggled) that the user hasn't clicked "Save" for yet, and the video should
// match what's on screen, not what's last on disk.
let renderJob = null;

app.post('/api/render', (req, res) => {
  if (renderJob && renderJob.status === 'running') {
    return res.status(409).json({ ok: false, error: 'A render is already in progress' });
  }

  try {
    const editable = filterEditable(req.body || {});
    const renderConfig = deepMerge(config, editable);
    // word.splitMode affects cue timing synthesis (loadCues), not just the
    // camera, so cues must be rebuilt from the merged config too — reusing
    // the server's cached `cues` would silently ignore an unsaved splitMode
    // change the same way a stale in-memory config would.
    const renderCues = loadCues(renderConfig);

    const ext = alphaOf(renderConfig.colors.background) < 1 ? '.mov' : '.mp4';
    const id = crypto.randomUUID();
    const outPath = path.join(os.tmpdir(), `lyrics-visualizer-render-${id}${ext}`);

    const previous = renderJob;
    renderJob = {
      id, status: 'running', frame: 0, frameCount: 0, t: 0, duration: 0, outPath, ext, error: null,
    };
    if (previous && previous.outPath) {
      fs.unlink(previous.outPath, () => {}); // best-effort; fine if it never finished
    }

    renderVideo(renderConfig, renderCues, outPath, {
      onProgress: ({
        frame, frameCount, t, duration,
      }) => {
        if (renderJob && renderJob.id === id) {
          Object.assign(renderJob, {
            frame, frameCount, t, duration,
          });
        }
      },
    }).then(() => {
      if (renderJob && renderJob.id === id) renderJob.status = 'done';
    }).catch((err) => {
      if (renderJob && renderJob.id === id) {
        renderJob.status = 'error';
        renderJob.error = err.message;
      }
    });

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/render/status', (req, res) => {
  if (!renderJob) return res.json({ status: 'idle' });
  const {
    id, status, frame, frameCount, t, duration, error,
  } = renderJob;
  res.json({
    id, status, frame, frameCount, t, duration, error,
  });
});

app.get('/api/render/download', (req, res) => {
  if (!renderJob || renderJob.status !== 'done') {
    return res.status(409).json({ ok: false, error: 'No finished render available' });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.download(renderJob.outPath, `lyrics-${stamp}${renderJob.ext}`);
});

app.get('/assets/font', (req, res) => res.sendFile(config.font.path));
if (config.audio) {
  app.get('/assets/audio', (req, res) => res.sendFile(config.audio));
}

const port = parseInt(opts.port, 10);
app.listen(port, () => {
  console.log(`lyrics-visualizer preview: http://localhost:${port}`);
});
