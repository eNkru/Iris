import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    dir: 'tests',
    resolve: {
      alias: {
        '@iris/prices/pipeline': resolve(__dirname, 'packages/prices/src/pipeline/index.ts'),
        '@iris/prices': resolve(__dirname, 'packages/prices/src/index.ts'),
      },
    },
  },
});
