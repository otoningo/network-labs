import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@/': fileURLToPath(new URL('./apps/web/', import.meta.url)) } },
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/web/lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts', 'packages/vendors/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/testing/**', '**/index.ts', '**/terminal.ts'],
      thresholds: {
        'packages/core/src/ops/**': { lines: 90, functions: 90 },
        'packages/core/src/engine/**': { lines: 90, functions: 90 },
        'packages/core/src/validate/**': { lines: 90, functions: 90 },
        'packages/vendors/src/routeros/**': { lines: 85, functions: 80 },
      },
    },
  },
});
