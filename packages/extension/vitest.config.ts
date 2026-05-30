import { defineProject } from 'vitest/config';
import path from 'node:path';

export default defineProject({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'src/test/mock-vscode.ts'),
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
