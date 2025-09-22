// vite.config.js
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  // We only bundle JS; HTML is served by your Express app.
  build: {
    outDir: 'public/assets',     // final files at /public/assets/*.js
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      // multiple entries -> multiple ESM outputs
      entry: {
        'connect.bundle':   path.resolve(__dirname, 'src/connect.ts'),
        'walletBet.bundle': path.resolve(__dirname, 'src/walletBet.ts'),
      },
      formats: ['es'],      // IMPORTANT: ESM with named exports
    },
    rollupOptions: {
      external: [],         // fully bundle deps for the browser
      output: {
        entryFileNames: '[name].js',              // /assets/connect.bundle.js, /assets/walletBet.bundle.js
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  resolve: {
    alias: {
      buffer: 'buffer',     // make sure "buffer" resolves to the npm shim
    },
    mainFields: ['browser', 'module', 'jsnext:main', 'main'],
    conditions: ['browser', 'import', 'module', 'default'],
  },
  define: {
    global: 'globalThis',
    'process.env': {},      // harmless stub some libs probe
  },
});
