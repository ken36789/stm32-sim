import { defineConfig } from 'vite';

export default defineConfig({
  // 相對路徑：部署在網域根目錄或子路徑（例如 GitHub Pages 的 /repo-name/）都能用
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
});
