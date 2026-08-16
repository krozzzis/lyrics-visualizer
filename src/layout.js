// Builds the text layout the camera pans/jumps across. Two modes:
//   'flow'    — every word from every cue, laid out left-to-right on one
//               long line (the original/default behavior).
//   'stacked' — cues grouped into logical lines (src/lines.js); each line's
//               words flow left-to-right in their own row, rows stacked
//               vertically by lineHeight * font.size.
// Every word and outCue always carries lineIndex/y (0 in flow mode, since
// there's only one row) so downstream code (camera.js, scene.js) doesn't
// need to branch on mode.
//
// Must be called with a 2D context whose ctx.font is already set to the exact
// same font string used at draw time (see fontString()) — layout and drawing
// share the same measurements by construction, in both browser and Node.

const { computeLines } = require('./lines');

function fontString(fontConfig) {
  const weight = fontConfig.weight || 'normal';
  const style = fontConfig.style || 'normal';
  return `${style} ${weight} ${fontConfig.size}px "${fontConfig.family}"`;
}

// Lays out one row's cues left-to-right starting at startX, appending to
// `words`/`outCues` (outCues indexed by original cue position, not row
// order, so downstream consumers can keep indexing it by cueIndex).
function layoutRow(ctx, cues, cueIndices, lineIndex, y, startX, wordGap, cueGap, words, outCues) {
  let x = startX;
  for (const cueIndex of cueIndices) {
    const cue = cues[cueIndex];
    const cueStartX = x;
    const cueWords = [];

    cue.words.forEach((word, wordIndex) => {
      const width = ctx.measureText(word.text).width;
      const w = {
        text: word.text, x, y, width, cueIndex, wordIndex, lineIndex, start: word.start, end: word.end,
      };
      cueWords.push(w);
      words.push(w);
      x += width + wordGap;
    });

    if (cueWords.length > 0) x -= wordGap; // no trailing gap after the last word of a cue
    const cueEndX = x;
    outCues[cueIndex] = {
      cueIndex,
      start: cue.start,
      end: cue.end,
      text: cue.text,
      startX: cueStartX,
      endX: cueEndX,
      centerX: (cueStartX + cueEndX) / 2,
      lineIndex,
      y,
      words: cueWords,
    };
    x += cueGap;
  }
  return x - cueGap; // last cue's end, before the trailing cueGap
}

function computeLayoutFlow(ctx, cues, layoutConfig) {
  const words = [];
  const outCues = [];
  const rowEnd = layoutRow(ctx, cues, cues.map((_, i) => i), 0, 0, 0, layoutConfig.wordGap, layoutConfig.cueGap, words, outCues);
  return { words, cues: outCues, totalWidth: Math.max(0, rowEnd) };
}

function computeLayoutStacked(ctx, cues, layoutConfig, fontConfig) {
  const { wordGap, cueGap } = layoutConfig;
  const chainFromEnd = layoutConfig.nextLineFrom === 'end';
  const rowSpacing = (fontConfig.size || 0) * (layoutConfig.lineHeight || 1.6);

  const words = [];
  const outCues = new Array(cues.length);
  const lines = computeLines(cues);

  let rowEnd = 0;
  let totalWidth = 0;
  lines.forEach((line, lineIndex) => {
    const startX = chainFromEnd ? rowEnd : 0;
    rowEnd = layoutRow(ctx, cues, line.cueIndices, lineIndex, lineIndex * rowSpacing, startX, wordGap, cueGap, words, outCues);
    totalWidth = Math.max(totalWidth, rowEnd);
  });

  return { words, cues: outCues, totalWidth };
}

function computeLayout(ctx, cues, layoutConfig, fontConfig) {
  if (layoutConfig.mode === 'stacked') {
    return computeLayoutStacked(ctx, cues, layoutConfig, fontConfig);
  }
  return computeLayoutFlow(ctx, cues, layoutConfig);
}

module.exports = { fontString, computeLayout };
