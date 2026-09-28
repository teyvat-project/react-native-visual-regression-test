import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // In your app, the package is installed and this alias is not needed.
      '@natsuneko-laboratory/react-native-visual-regression-test/vitest': fileURLToPath(new URL('../src/vitest/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['vrt/**/*.test.ts'],
  },
});
