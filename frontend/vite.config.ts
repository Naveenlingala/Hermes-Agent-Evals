import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../backend/src/domain/types.ts', import.meta.url)) } },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3000' } },
  test: { environment: 'node' },
});
