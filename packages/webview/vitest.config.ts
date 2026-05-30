import { defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineProject({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: true,
  },
});
