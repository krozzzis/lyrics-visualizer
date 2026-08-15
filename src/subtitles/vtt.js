const { vttTimeToSeconds } = require('./time');

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '');
}

function parseVtt(content) {
  const body = content.replace(/\r\n/g, '\n').replace(/^WEBVTT[^\n]*\n/, '');
  const blocks = body.split(/\n\n+/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;

    let idx = 0;
    if (!lines[0].includes('-->')) idx = 1; // skip optional cue identifier
    const timingLine = lines[idx];
    if (!timingLine || !timingLine.includes('-->')) continue;

    const [startStr, endStr] = timingLine.split('-->').map((s) => s.trim().split(' ')[0]);
    const start = vttTimeToSeconds(startStr);
    const end = vttTimeToSeconds(endStr);

    const text = stripTags(lines.slice(idx + 1).join(' ')).replace(/\s+/g, ' ').trim();
    if (!text) continue;

    cues.push({ start, end, text, words: text.split(/\s+/).map((w) => ({ text: w })) });
  }

  return cues;
}

module.exports = { parseVtt };
