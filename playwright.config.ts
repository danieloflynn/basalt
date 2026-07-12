import { defineConfig } from '@playwright/test';

/**
 * Visual regression suite: drives the real app in browser-dev mode (mock git
 * engine + demo vault) at a Pixel-ish phone viewport and pixel-compares every
 * screen. Baselines live in tests/visual/__screenshots__ and are committed —
 * a diff there is a UI change, intended or not.
 */
export default defineConfig({
  testDir: 'tests/visual',
  fullyParallel: true,
  timeout: 60_000,
  retries: 0,
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: 'http://localhost:4823',
    viewport: { width: 393, height: 851 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  },
  webServer: {
    command: 'npx vite --port 4823 --strictPort',
    url: 'http://localhost:4823',
    reuseExistingServer: true,
  },
});
