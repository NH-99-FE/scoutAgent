import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'packages/extension/test/mock-vscode.ts'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'], // 输出格式
      reportsDirectory: './coverage', // 报告输出目录
      include: ['packages/*/src/**/*.{ts,tsx}'], // 只统计 src 下的源码
      exclude: [
        'packages/*/src/**/*.test.{ts,tsx}',
        'packages/*/src/test/**',
        'packages/*/src/**/types.ts',
        'packages/*/src/**/index.ts',
      ],
      thresholds: {
        // 可选：覆盖率门槛
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
