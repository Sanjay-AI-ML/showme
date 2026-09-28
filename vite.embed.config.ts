import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: 'dist/client/embed',
    emptyOutDir: false,
    lib: { entry: resolve('sdk/auto-embed.ts'), name: 'ShowMeEmbed', formats: ['iife'], fileName: () => 'showme.js' },
  },
});
