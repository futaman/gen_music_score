// 検証者のロジック検証（docs/verification/spec.md の L3）。`npm test` とは別に動かす
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: new URL('../..', import.meta.url).pathname,
    include: ['tests/verification/logic/**/*.test.ts'],
    testTimeout: 60000,
  },
});
