import { defineConfig } from 'vite';

// テスト素材をそのまま /musicxml/... で配信する（試作専用）
export default defineConfig({
  base: './',
  publicDir: '../../test-assets',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 10000, rollupOptions: { input: ['index.html', 'osmd.html'] } },
});
