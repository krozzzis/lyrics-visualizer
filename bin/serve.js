#!/usr/bin/env node
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const yaml = require('js-yaml');
const { Command } = require('commander');

const { loadConfig, deepMerge } = require('../src/config');
const { loadCues } = require('../src/cues');
const { renderVideo } = require('../src/render');
const { alphaOf } = require('../src/color');
const { ensureNativeSubtitle } = require('../src/convertSubtitle');
const { wordsFromText } = require('../src/subtitles');
const { serializeNative } = require('../src/subtitles/native');
const {
  loadMarkers, saveMarkers, sanitizeOverrides, backgroundNeedsAlpha,
} = require('../src/configMarkers');

const program = new Command();
program
  .requiredOption('-c, --config <path>', 'path to config.yaml')
  .option('-p, --port <n>', 'port to listen on', '8080')
  .parse(process.argv);

const opts = program.opts();
ensureNativeSubtitle(opts.config);
let config = loadConfig(opts.config);
let cues = loadCues(config);
let markers = loadMarkers(opts.config);

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
  res.json({
    config: publicConfig, cues, configMarkers: markers,
  });
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

// Persists cue edits (text/timestamps from the timeline or sidebar) to the
// native JSON subtitle file. Every cue is replaced wholesale — the client is
// authoritative on start/end/text — and words[] is always re-derived from
// text here rather than trusted from the client, since editing a cue's text
// invalidates whatever word split (and any karaoke word timing) it had.
app.post('/api/cues', (req, res) => {
  try {
    const incoming = (req.body || {}).cues;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ ok: false, error: 'Expected { cues: [...] }' });
    }
    if (path.extname(config.subtitle).toLowerCase() !== '.json') {
      // Should be unreachable: ensureNativeSubtitle() runs at startup. Guards
      // against ever silently overwriting a non-native source file.
      return res.status(409).json({ ok: false, error: 'subtitle is not in native format' });
    }

    const newCues = incoming.map((c) => {
      if (typeof c.start !== 'number' || typeof c.end !== 'number' || typeof c.text !== 'string') {
        throw new Error('Each cue needs numeric start/end and string text');
      }
      const cue = {
        start: c.start, end: c.end, text: c.text, words: wordsFromText(c.text),
      };
      // Logical-line grouping (see web-src/Player.jsx groupSelected/ungroupSelected):
      // an id shared by cues that are fragments of the same subtitle line.
      // Omitted entirely for ungrouped cues, rather than null, to keep the
      // native JSON minimal for the common case.
      if (c.lineId) cue.lineId = c.lineId;
      return cue;
    }).sort((a, b) => a.start - b.start);

    fs.writeFileSync(config.subtitle, serializeNative(newCues), 'utf8');
    cues = newCues;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Persists config-marker edits (add/move/delete/override changes from the
// timeline) to config-markers.json, right away — like /api/cues and
// /api/config, since a marker edit is already a single, deliberate, complete
// action rather than a batch of unrelated tweaks. Every marker's `overrides`
// is sanitized to the same whitelist drawFrame actually resolves (camera/
// colors/style) so a stray field can't silently pretend to work.
app.post('/api/markers', (req, res) => {
  try {
    const incoming = (req.body || {}).markers;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ ok: false, error: 'Expected { markers: [...] }' });
    }

    const newMarkers = incoming.map((m) => {
      if (typeof m.id !== 'string' || typeof m.time !== 'number' || !Number.isFinite(m.time)) {
        throw new Error('Each marker needs a string id and numeric time');
      }
      return { id: m.id, time: Math.max(0, m.time), overrides: sanitizeOverrides(m.overrides) };
    }).sort((a, b) => a.time - b.time);

    saveMarkers(opts.config, newMarkers);
    markers = newMarkers;
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
// the settings panel autosaves on a short debounce (see SettingsPanel.jsx),
// so an edit made just before hitting render may not have reached disk yet,
// and the video should match what's on screen, not what's last on disk.
let renderJob = null;
const projectDir = path.dirname(path.resolve(opts.config));
const rendersDir = path.join(projectDir, 'renders');
// Accumulated render output lives in the project folder now, so it's just
// static files — served under a stable per-file URL rather than routed
// through a single mutable "whatever the last render was" endpoint.
app.use('/renders', express.static(rendersDir));

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

    const ext = backgroundNeedsAlpha(renderConfig, markers, alphaOf) ? '.mov' : '.mp4';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(rendersDir, { recursive: true });
    const outPath = path.join(rendersDir, `lyrics-${stamp}${ext}`);

    const id = crypto.randomUUID();
    // Rendered files are user-visible output living in the project folder now
    // (not scratch temp files), so — unlike the old os.tmpdir() path — a new
    // render never deletes the previous one.
    renderJob = {
      id, status: 'running', frame: 0, frameCount: 0, t: 0, duration: 0, outPath, ext, error: null,
    };

    renderVideo(renderConfig, renderCues, outPath, {
      markers,
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
    id, status, frame, frameCount, t, duration, error, outPath,
  } = renderJob;
  res.json({
    id,
    status,
    frame,
    frameCount,
    t,
    duration,
    error,
    // Relative to the project dir so the UI can show where the file landed
    // without leaking the server's absolute filesystem layout.
    outPath: outPath ? path.relative(projectDir, outPath) : null,
    // A stable per-file URL (served statically from rendersDir) rather than
    // a fixed endpoint whose backing file changes across renders.
    url: outPath ? `/renders/${encodeURIComponent(path.basename(outPath))}` : null,
  });
});

app.get('/assets/font', (req, res) => res.sendFile(config.font.path));
if (config.audio) {
  app.get('/assets/audio', (req, res) => res.sendFile(config.audio));
}

const port = parseInt(opts.port, 10);
app.listen(port, () => {
  console.log(`lyrics-visualizer preview: http://localhost:${port}`);
});
