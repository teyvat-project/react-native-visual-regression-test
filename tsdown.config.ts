import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    // Consumed by Metro, which transpiles it again for Hermes.
    entry: { index: 'src/native/index.tsx' },
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    outDir: 'lib',
    dts: true,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
  {
    entry: { vitest: 'src/vitest/index.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outDir: 'lib',
    dts: true,
    outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
  },
]);
