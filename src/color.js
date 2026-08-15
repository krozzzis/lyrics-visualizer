// Normalizes config color strings for both the canvas fillStyle and for the
// CLI renderer's decision on which video container/codec supports alpha.

function toCanvasFill(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (s.toLowerCase() === 'transparent') return null;

  const hex6 = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},1)`;
  }

  const hex8 = /^#([0-9a-f]{8})$/i.exec(s);
  if (hex8) {
    const n = parseInt(hex8[1], 16) >>> 0;
    const a = (n & 255) / 255;
    return `rgba(${(n >>> 24) & 255},${(n >>> 16) & 255},${(n >>> 8) & 255},${a.toFixed(3)})`;
  }

  return s; // rgb()/rgba()/hsl()/named colors: pass through, canvas parses these natively
}

// Returns the alpha channel (0-1) for colors we can introspect, or 1
// (assume opaque) for anything else. Used to pick a video container that
// can carry transparency.
function alphaOf(input) {
  if (input == null) return 0;
  const s = String(input).trim();
  if (s.toLowerCase() === 'transparent') return 0;

  const hex8 = /^#([0-9a-f]{8})$/i.exec(s);
  if (hex8) return (parseInt(hex8[1].slice(6, 8), 16)) / 255;

  const rgba = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (rgba) return rgba[1] === undefined ? 1 : parseFloat(rgba[1]);

  return 1;
}

module.exports = { toCanvasFill, alphaOf };
