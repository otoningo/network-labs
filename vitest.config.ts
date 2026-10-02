import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/testing/**', '**/index.ts'],
      thresholds: {
        'packages/core/src/ops/**': { lines: 90, functions: 90 },
        'packages/core/src/engine/**': { lines: 90, functions: 90 },
        'packages/core/src/validate/**': { lines: 90, functions: 90 },
      },
    },
  },
});
