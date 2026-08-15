import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  root: 'web-src',
  base: './',
  plugins: [solid()],
  build: {
    outDir: '../web/dist',
    emptyOutDir: true,
    commonjsOptions: {
      // src/*.js (scene.js, layout.js, camera.js, color.js) are plain
      // CommonJS — shared as-is with the Node CLI renderer for framing
      // parity. Rollup's CJS interop defaults to node_modules only; this
      // pulls our own src/ tree into that same handling so its internal
      // require() calls get bundled instead of left as literal `require(...)`
      // (which doesn't exist at runtime in a browser).
      include: [/src\/.*\.js$/, /node_modules/],
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/assets': 'http://localhost:8080',
    },
  },
});
