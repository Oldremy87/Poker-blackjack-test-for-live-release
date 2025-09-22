// vite.config.js
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  publicDir: false,                // don't copy /public into /public/assets
  build: {
    outDir: 'public/assets',
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: true,               // turn on for readable stack traces in dev
    minify: false,                 // TEMP: avoid TDZ-obscuring minification while we verify
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
      commonjsOptions: {
        transformMixedEsModules: true,
        requireReturnsDefault: 'auto',
        strictRequires: false,
      },
    },
  },
  resolve: {
    alias: {
      // ✅ force crypto to our ESM shim that guarantees createHash etc.
      crypto: path.resolve(__dirname, 'src/shims/crypto.ts'),

      // ✅ browser shims for other Node built-ins
      stream: 'stream-browserify',
      buffer: 'buffer',
      events: 'events/',
      util: 'util/',
    },
    dedupe: ['nexa-wallet-sdk', 'libnexa-ts', '@vgrunner/electrum-cash'], // avoid double instances
    mainFields: ['browser', 'module', 'jsnext:main', 'main'],
    conditions: ['browser', 'import', 'module', 'default'],
  },
  define: {
    global: 'globalThis',
    'process.env': {},
  },
  optimizeDeps: {
    // ✅ prebundle every crypto/elliptic dependency so no raw `require()` reaches the browser
    include: [
      'nexa-wallet-sdk',
      'libnexa-ts',
      '@vgrunner/electrum-cash',
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
