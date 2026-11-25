import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@portalverse/core': resolve(__dirname, 'packages/core/src'),
      '@portalverse/worlds': resolve(__dirname, 'worlds'),
      '@portalverse/server': resolve(__dirname, 'packages/server/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'worlds/**/*.test.ts'],
  },
});
