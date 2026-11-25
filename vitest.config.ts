import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/sim/**/*.ts', 'src/cli/lap.ts', 'src/cli/race.ts', 'src/ui/format.ts', 'src/ui/inputState.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
    },
  },
});
