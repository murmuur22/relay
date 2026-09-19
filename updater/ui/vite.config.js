import { defineConfig } from 'vite';
export default defineConfig({ base: '/updater/', server: { port: 4283, strictPort: true }, preview: { port: 4283, strictPort: true }, build: { chunkSizeWarningLimit: 650 } });
