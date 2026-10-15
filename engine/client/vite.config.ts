import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './', // relative, so the site works at user.github.io/repo/ and at a custom domain
  plugins: [react()],
  build: {
    // The page, and the helpers its owner uses to write content/whatiiif.toml and content/notes.md.
    rollupOptions: { input: { index: page('index.html'), settings: page('settings.html'), notes: page('notes.html') } },
    outDir: fileURLToPath(new URL('../../dist', import.meta.url)),
    emptyOutDir: true, // `npm run build` makes the page first, then engine/build.js adds the image to it
    chunkSizeWarningLimit: 4000, // Mirador is large but only loaded when chosen
  },
});
