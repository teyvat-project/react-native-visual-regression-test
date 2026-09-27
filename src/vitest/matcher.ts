import { resolve } from 'node:path';
import { expect } from 'vitest';
import { compareScreenshot, resolveUpdateMode, type CompareResult, type ThresholdOptions, type UpdateMode } from './compare';

export type VrtMatcherOptions = ThresholdOptions & {
  /** Directory for `<name>.png` baselines. Default: `__vrt__`, relative to the working directory. */
  snapshotDir?: string;
  /** Overrides Vitest's update mode (`-u`). */
  update?: UpdateMode | boolean;
};

declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    /** Compares PNG bytes (from `captureStory`) with `<snapshotDir>/<name>.png`. */
    toMatchVrtScreenshot(name: string, options?: ThresholdOptions): R;
  }
}

type Counter = { increment?(key: string): void };
type SnapshotStateLike = {
  _updateSnapshot?: unknown;
  added?: Counter;
  updated?: Counter;
  matched?: Counter;
  unmatched?: Counter;
};

const COUNTERS = {
  added: 'added',
  updated: 'updated',
  matched: 'matched',
  missing: 'unmatched',
  mismatched: 'unmatched',
} as const;

function snapshotState(): SnapshotStateLike | undefined {
  return (expect.getState() as unknown as { snapshotState?: SnapshotStateLike }).snapshotState;
}

/** The update mode Vitest runs with: `all` for `-u`, `none` on CI, `new` otherwise. */
export function vitestUpdateMode(): UpdateMode {
  const mode = snapshotState()?._updateSnapshot;
  if (mode === 'all' || mode === 'new' || mode === 'none') return mode;
  return process.env.CI ? 'none' : 'new';
}

/** Counts the result in Vitest's snapshot summary ("written", "updated", "failed"). */
export function recordSnapshotResult(result: CompareResult, key: string): void {
  snapshotState()?.[COUNTERS[result.status]]?.increment?.(key);
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function assertSnapshotName(name: string): void {
  if (!SAFE_NAME.test(name) || name.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error(`Invalid screenshot name "${name}": use letters, numbers, ".", "_", "-", and "/" between segments`);
  }
}

/** Registers `expect(png).toMatchVrtScreenshot(name)`. Call it in a setup file or at the top of a test file. */
export function installVrtMatcher(defaults: VrtMatcherOptions = {}): void {
  expect.extend({
    toMatchVrtScreenshot(received: unknown, name: string, options: ThresholdOptions = {}) {
      if (this.isNot) throw new Error('toMatchVrtScreenshot cannot be used with .not');
      if (!Buffer.isBuffer(received)) throw new TypeError('toMatchVrtScreenshot expects PNG bytes, such as the result of captureStory()');
      assertSnapshotName(name);
      const baselinePath = resolve(defaults.snapshotDir ?? '__vrt__', `${name}.png`);
      const result = compareScreenshot(received, baselinePath, {
        ...defaults,
        ...options,
        update: resolveUpdateMode(defaults.update, vitestUpdateMode()),
      });
      recordSnapshotResult(result, `${this.currentTestName ?? name} ${name}`);
      return { pass: result.pass, message: () => result.message };
    },
  });
}
