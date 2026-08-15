const { GlobalFonts } = require('@napi-rs/canvas');

// Registers the config's bundled font file under the exact family name given
// in config.font.family, so ctx.font (built by fontString()) resolves to the
// same glyphs/metrics regardless of what the font's internal name table says.
function registerConfigFont(config) {
  GlobalFonts.registerFromPath(config.font.path, config.font.family);
}

module.exports = { registerConfigFont };
