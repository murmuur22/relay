import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
export default defineConfig(({ mode }) => ({
  base: mode === 'presentation' ? `/updater/presentation/v${version}/` : '/updater/',
  server: { port: 4283, strictPort: true }, preview: { port: 4283, strictPort: true },
  build: { chunkSizeWarningLimit: 650, outDir: mode === 'presentation' ? 'presentation-dist' : 'dist' },
}));
