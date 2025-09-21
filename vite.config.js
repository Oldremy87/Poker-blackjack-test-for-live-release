// vite.config.js
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  appType: 'custom',
  publicDir: 'public',
  resolve: {
    alias: {
      // Force browser-safe substitutes:
      events: path.resolve(__dirname, 'src/shims/events.js'),
      tls:    path.resolve(__dirname, 'src/shims/empty.js'),
      net:    path.resolve(__dirname, 'src/shims/empty.js'),
      // If some deps try to import 'crypto' Node API, keep Vite’s browser external;
      // the Nexa libs typically use WebCrypto in their browser entry (index.web.mjs),
      // so we don’t alias 'crypto' unless you see a follow-up error.
    },
    // Prefer browser entry points where packages provide them.
    conditions: ['browser', 'module', 'import', 'default'],
  },
  build: {
    outDir: 'public/assets',
    emptyOutDir: false,
    target: 'es2022',
    rollupOptions: {
      input: {
        connect:   path.resolve(__dirname, 'src/connect.js'),
        walletBet: path.resolve(__dirname, 'src/wallet-bet.js'),
      },
      output: {
        entryFileNames: '[name].bundle.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});