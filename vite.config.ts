import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: { target: 'es2022' },
  test: {
    // Playwright owns tests/visual; electron/ holds the desktop git-engine tests.
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
});
