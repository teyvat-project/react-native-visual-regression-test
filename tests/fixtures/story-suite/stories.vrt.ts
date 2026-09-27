import { defineStoryTests } from '../../../src/vitest/index';

await defineStoryTests({
  port: Number(process.env.VRT_PORT),
  snapshotDir: process.env.VRT_SNAPSHOT_DIR,
  connectTimeoutMs: 10_000,
  captureTimeoutMs: 5_000,
  tags: { skip: ['flaky'] },
});
