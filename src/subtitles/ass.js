const { assTimeToSeconds } = require('./time');

// Strip ASS override blocks {\...} but capture \k/\kf/\ko karaoke timing tags
// (in centiseconds) so word-level timing can be reconstructed when present.
function parseAssText(rawText, cueStart) {
  // Normalize forced line breaks to spaces since everything renders on one line.
  const text = rawText.replace(/\\N|\\n/g, ' ');

  const karaokeTags = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      const end = text.indexOf('}', i);
      const block = end === -1 ? text.slice(i) : text.slice(i, end + 1);
      const kMatch = /\\k[fo]?(\d+)/.exec(block);
      if (kMatch) karaokeTags.push({ atIndex: plain.length, centiseconds: +kMatch[1] });
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (text[i] === '\\' && text[i + 1] === 'h') {
      plain += ' ';
      i += 2;
      continue;
    }
    plain += text[i];
    i += 1;
  }

  const trimmed = plain.trim();
  if (!trimmed) return { text: '', words: [] };

  if (karaokeTags.length === 0) {
    return { text: trimmed, words: trimmed.split(/\s+/).map((w) => ({ text: w })) };
  }

  // Reconstruct word-level start/end times from karaoke durations. Each \k tag
  // covers the syllable/word text that follows it up to the next tag.
  const words = [];
  let cursor = cueStart;
  for (let t = 0; t < karaokeTags.length; t += 1) {
    const tag = karaokeTags[t];
    const nextIndex = t + 1 < karaokeTags.length ? karaokeTags[t + 1].atIndex : plain.length;
    const segment = plain.slice(tag.atIndex, nextIndex);
    const dur = tag.centiseconds / 100;
    const start = cursor;
    const end = cursor + dur;
    cursor = end;
    for (const w of segment.trim().split(/\s+/)) {
      if (w) words.push({ text: w, start, end });
    }
  }

  return { text: trimmed, words: words.length ? words : trimmed.split(/\s+/).map((w) => ({ text: w })) };
}

function parseAss(content) {
  const lines = content.split(/\r?\n/);
  let inEvents = false;
  let format = null;
  const cues = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[Events\]/i.test(trimmed)) {
      inEvents = true;
      continue;
    }
    if (/^\[.+\]/.test(trimmed)) {
      inEvents = false;
      continue;
    }
    if (!inEvents) continue;

    if (/^Format:/i.test(trimmed)) {
      format = trimmed.slice(trimmed.indexOf(':') + 1).split(',').map((s) => s.trim());
      continue;
    }
    if (!/^Dialogue:/i.test(trimmed)) continue;
    if (!format) throw new Error('ASS file has Dialogue lines before a Format: line in [Events]');

    const value = trimmed.slice(trimmed.indexOf(':') + 1);
    const fields = value.split(',');
    const textIndex = format.length - 1;
    // The Text field itself may contain commas, so rejoin anything past the declared fields.
    const head = fields.slice(0, textIndex);
    const text = fields.slice(textIndex).join(',');

    const rec = {};
    format.forEach((name, idx) => {
      if (idx < textIndex) rec[name] = head[idx];
    });
    rec.Text = text;

    if (!rec.Start || !rec.End) continue;
    const start = assTimeToSeconds(rec.Start);
    const end = assTimeToSeconds(rec.End);
    const parsed = parseAssText(rec.Text || '', start);
    if (!parsed.text) continue; // skip empty/whitespace-only dialogue lines

    cues.push({ start, end, text: parsed.text, words: parsed.words });
  }

  return cues;
}

module.exports = { parseAss };
