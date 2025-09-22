import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public/assets',
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: {
        'connect.bundle':   path.resolve(__dirname, 'src/connect.ts'),
        'walletBet.bundle': path.resolve(__dirname, 'src/walletBet.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
      // ✅ aggressively convert CJS (even in ESM files)
      //    and allow Rollup to rewrite dynamic requires.
      // (Vite includes commonjs internally; these options help edge cases.)
      commonjsOptions: {
        transformMixedEsModules: true,
        requireReturnsDefault: 'auto',
      },
    },
  },
  resolve: {
    alias: {
      crypto: path.resolve(__dirname, 'src/shims/crypto.ts'), // our ESM shim
      stream: 'stream-browserify',
      buffer: 'buffer',
      events: 'events/',
      util: 'util/',
    },
    mainFields: ['browser', 'module', 'jsnext:main', 'main'],
    conditions: ['browser', 'import', 'module', 'default'],
  },
  define: {
    global: 'globalThis',
    'process.env': {},
  },
  optimizeDeps: {
    // ✅ prebundle the usual crypto stack so `require` never reaches the browser
    include: [
      'buffer',
      'process',
      'stream-browserify',
      'events',
      'util',
      'crypto-browserify',
      'create-hash',
      'create-hmac',
      'sha.js',
      'ripemd160',
      'hash.js',
      'bn.js',
      'elliptic',
      'hmac-drbg',
      'inherits',
      'safe-buffer',
      'randombytes',
    ],
    force: true,
  },
});
