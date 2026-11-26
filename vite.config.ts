import { defineConfig } from 'vite';
import { roomBuildBudget } from './scripts/roomBuildBudget';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [roomBuildBudget()],
  // Pre-bundle the on-demand dev panel so its first open doesn't reload the running world.
  optimizeDeps: { include: ['leva', 'react', 'react-dom/client'] },
  resolve: {
    alias: {
      '@portalverse/core': resolve(__dirname, 'packages/core/src'),
      '@portalverse/worlds': resolve(__dirname, 'worlds'),
      '@portalverse/server': resolve(__dirname, 'packages/server/src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
