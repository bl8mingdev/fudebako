import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Relative base so the same build runs from a web server, a sub-folder, or inside Tauri.
export default defineConfig({
  base: './',
  resolve: {
    // elkjs (EPL-2.0, 1.4 MB) is only used by Mermaid's optional `layout: elk`; replace it with a stub
    alias: { 'elkjs/lib/elk.bundled.js': fileURLToPath(new URL('./src/stubs/elk.js', import.meta.url)) },
  },
  clearScreen: false,
  server: { port: 5173, strictPort: true, host: process.env.TAURI_DEV_HOST || false },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: ['es2021', 'chrome100', 'safari15'],
    chunkSizeWarningLimit: 1500,
    reportCompressedSize: false,
  },
});
