import { defineConfig } from 'vitest/config';

// The web app has its own tests and config (web/vite.config.ts).
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
