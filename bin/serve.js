#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const express = require('express');
const yaml = require('js-yaml');
const { Command } = require('commander');

const { loadConfig, deepMerge } = require('../src/config');
const { loadCues } = require('../src/cues');

const program = new Command();
program
  .requiredOption('-c, --config <path>', 'path to config.yaml')
  .option('-p, --port <n>', 'port to listen on', '8080')
  .parse(process.argv);

const opts = program.opts();
const config = loadConfig(opts.config);
const cues = loadCues(config);

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

app.post('/api/config', (req, res) => {
  try {
    const body = req.body || {};
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

    const raw = fs.readFileSync(opts.config, 'utf8');
    const parsed = yaml.load(raw) || {};
    const merged = deepMerge(parsed, editable);
    fs.writeFileSync(opts.config, yaml.dump(merged, { lineWidth: 100 }), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/assets/font', (req, res) => res.sendFile(config.font.path));
if (config.audio) {
  app.get('/assets/audio', (req, res) => res.sendFile(config.audio));
}

const port = parseInt(opts.port, 10);
app.listen(port, () => {
  console.log(`lyrics-visualizer preview: http://localhost:${port}`);
});
