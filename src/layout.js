// Builds the "single long line" text layout: every word from every cue,
// laid out left-to-right with measureText, so the camera can pan/jump along X.
//
// Must be called with a 2D context whose ctx.font is already set to the exact
// same font string used at draw time (see fontString()) — layout and drawing
// share the same measurements by construction, in both browser and Node.

function fontString(fontConfig) {
  const weight = fontConfig.weight || 'normal';
  const style = fontConfig.style || 'normal';
  return `${style} ${weight} ${fontConfig.size}px "${fontConfig.family}"`;
}

function computeLayout(ctx, cues, layoutConfig) {
  const wordGap = layoutConfig.wordGap;
  const cueGap = layoutConfig.cueGap;

  const words = [];
  const outCues = [];
  let x = 0;

  cues.forEach((cue, cueIndex) => {
    const cueStartX = x;
    const cueWords = [];

    cue.words.forEach((word, wordIndex) => {
      const width = ctx.measureText(word.text).width;
      cueWords.push({
        text: word.text,
        x,
        width,
        cueIndex,
        wordIndex,
        start: word.start,
        end: word.end,
      });
      words.push(cueWords[cueWords.length - 1]);
      x += width + wordGap;
    });

    if (cueWords.length > 0) x -= wordGap; // no trailing gap after the last word of a cue
    const cueEndX = x;
    outCues.push({
      cueIndex,
      start: cue.start,
      end: cue.end,
      text: cue.text,
      startX: cueStartX,
      endX: cueEndX,
      centerX: (cueStartX + cueEndX) / 2,
      words: cueWords,
    });
    x += cueGap;
  });

  return { words, cues: outCues, totalWidth: Math.max(0, x - cueGap) };
}

module.exports = { fontString, computeLayout };
