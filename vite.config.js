// vite.config.js
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  appType: 'custom',          // don’t look for index.html
  publicDir: 'public',
  resolve: {
    // prefer browser builds when packages offer them
    mainFields: ['browser', 'module', 'jsnext:main', 'main'],
    conditions: ['browser', 'import', 'module', 'default'],
    alias: [
      // browser-friendly debug
      { find: 'debug',  replacement: 'debug/src/browser.js' },
      // standard browser polyfills that Vite understands
      { find: 'events', replacement: 'events/' },
      { find: 'util',   replacement: 'util/' },
      // hard-block Node-only modules by pointing to our empty shim
      { find: 'tls',    replacement: path.resolve(__dirname, 'src/shims/empty.js') },
      { find: 'net',    replacement: path.resolve(__dirname, 'src/shims/empty.js') },
    ],
  },
  optimizeDeps: {
    include: ['buffer', 'process', 'events', 'util', 'debug/src/browser.js'],
  },
  build: {
    target: 'es2022',
    outDir: 'public',       // emit straight into /public
    emptyOutDir: false,     // don’t wipe your existing html/css
    rollupOptions: {
      input: {
        'assets/polyfills':        path.resolve(__dirname, 'src/polyfills.ts'),
        'assets/connect.bundle':   path.resolve(__dirname, 'src/connect.ts'),
        'assets/walletBet.bundle': path.resolve(__dirname, 'src/walletBet.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
      // optional: keep build logs clean
      onwarn(warning, warn) {
        // guard TS type issues (some warnings don't have .source)
        if (warning.code === 'UNRESOLVED_IMPORT' && warning.source && /^(tls|net)$/.test(String(warning.source))) {
          throw new Error(`Node-only module imported: ${warning.source}`);
        }
        warn(warning);
      },
    },
  },
});
