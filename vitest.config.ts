import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    dir: 'tests',
  },
  // Workspace aliases must live at the Vite level so unit tests can import
  // `@iris/utils` / `@iris/database`. `test.resolve.alias` is not applied to those.
  resolve: {
    alias: {
      '@iris/prices/pipeline': resolve(__dirname, 'packages/prices/src/pipeline/index.ts'),
      '@iris/prices': resolve(__dirname, 'packages/prices/src/index.ts'),
      '@iris/utils': resolve(__dirname, 'packages/utils/src/index.ts'),
      '@iris/database/drizzle/queries': resolve(
        __dirname,
        'packages/database/src/drizzle/queries/index.ts',
      ),
      '@iris/database': resolve(__dirname, 'packages/database/src/index.ts'),
    },
  },
});
