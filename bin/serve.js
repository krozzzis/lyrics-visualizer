#!/usr/bin/env node
const { Command } = require('commander');
const { createServer } = require('../src/server');

const program = new Command();
program
  .requiredOption('-c, --config <path>', 'path to config.yaml')
  .option('-p, --port <n>', 'port to listen on', '8080')
  .parse(process.argv);

const opts = program.opts();

let app;
try {
  ({ app } = createServer(opts.config));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const port = parseInt(opts.port, 10);
app.listen(port, () => {
  console.log(`lyrics-visualizer preview: http://localhost:${port}`);
});
