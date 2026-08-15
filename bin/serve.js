#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Command } = require('commander');

const { loadConfig } = require('../src/config');
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

app.get('/assets/font', (req, res) => res.sendFile(config.font.path));
if (config.audio) {
  app.get('/assets/audio', (req, res) => res.sendFile(config.audio));
}

const port = parseInt(opts.port, 10);
app.listen(port, () => {
  console.log(`lyrics-visualizer preview: http://localhost:${port}`);
});
