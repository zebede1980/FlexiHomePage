import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// One codebase, two builds:
//   vite build             the browser extension, in dist/ (load it unpacked)
//   vite build --mode web  the hosted site, in dist-web/ (served by server/)
// `import.meta.env.MODE === 'web'` is how the page code tells them apart.
export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  const input: Record<string, string> = web
    ? { index: 'index.html' }
    : { newtab: 'newtab.html', bridge: 'bridge.html', background: 'src/bridge/background.ts' };
  return {
    plugins: [svelte()],
    base: web ? '/' : './',
    build: {
      outDir: web ? 'dist-web' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      rollupOptions: {
        input,
        output: {
          // The manifest names the service worker, so it can't carry a content hash.
          entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        },
      },
    },
    server: {
      // `npm run dev:web` runs the page against a local FlexiHome server (`npm run dev:server`).
      proxy: web ? { '/api': 'http://127.0.0.1:3031' } : undefined,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'server/test/**/*.test.ts'],
    },
  };
});
