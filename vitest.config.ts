import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { weft } from '@ericrius1/weft/vite';

export default defineConfig({
  // weft ships extensionless ES modules and .wgsl imports: let Vite transform it in tests too.
  plugins: [weft()],
  resolve: {
    alias: {
      '@portalverse/core': resolve(__dirname, 'packages/core/src'),
      '@portalverse/worlds': resolve(__dirname, 'worlds'),
      '@portalverse/server': resolve(__dirname, 'packages/server/src'),
    },
  },
  test: {
    environment: 'node',
    server: { deps: { inline: ['@ericrius1/weft'] } },
    include: ['packages/**/*.test.ts', 'worlds/**/*.test.ts'],
  },
});
