import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/** Same meaning as Vitest's snapshot update state: `all` rewrites, `new` only adds missing, `none` never writes. */
export type UpdateMode = 'all' | 'new' | 'none';

export type ThresholdOptions = {
  /** pixelmatch color threshold between 0 and 1. Default: 0.1. */
  threshold?: number;
  /** Number of differing pixels that still passes. Default: 0. */
  maxDiffPixels?: number;
  /** Ratio of differing pixels (0 to 1) that still passes. The larger of the two limits applies. Default: 0. */
  maxDiffPixelRatio?: number;
};

export type CompareOptions = ThresholdOptions & {
  /** `true` is `all` and `false` is `none`. Default: `none`. */
  update?: UpdateMode | boolean;
  /** Where failure images are written. Default: `__diffs__` next to the baseline. */
  diffDir?: string;
};

export type CompareStatus = 'matched' | 'added' | 'updated' | 'missing' | 'mismatched';

export type CompareResult = {
  status: CompareStatus;
  pass: boolean;
  message: string;
  baselinePath: string;
  /** Image with expected, actual, and highlighted differences side by side. */
  diffPath?: string;
  actualPath?: string;
  diffPixels?: number;
};

const PANEL_GAP = 8;
const GAP_COLOR = [128, 128, 128, 255];

export function resolveUpdateMode(update: UpdateMode | boolean | undefined, fallback: UpdateMode): UpdateMode {
  if (update === true) return 'all';
  if (update === false) return 'none';
  return update ?? fallback;
}

function display(path: string): string {
  const relativePath = relative(process.cwd(), path);
  return relativePath && !relativePath.startsWith('..') ? relativePath : path;
}

function decode(bytes: Buffer, what: string): PNG {
  try {
    return PNG.sync.read(bytes);
  } catch (error) {
    throw new Error(`${what} is not a valid PNG: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Places images next to each other on a gray background. */
function sideBySide(images: PNG[]): PNG {
  const width = images.reduce((sum, image) => sum + image.width, 0) + PANEL_GAP * (images.length - 1);
  const height = Math.max(...images.map((image) => image.height));
  const output = new PNG({ width, height });
  for (let i = 0; i < output.data.length; i += 4) output.data.set(GAP_COLOR, i);
  let x = 0;
  for (const image of images) {
    PNG.bitblt(image, output, 0, 0, image.width, image.height, x, 0);
    x += image.width + PANEL_GAP;
  }
  return output;
}

function failurePaths(baselinePath: string, diffDir: string | undefined) {
  const directory = diffDir ?? join(dirname(baselinePath), '__diffs__');
  const name = basename(baselinePath, '.png');
  return { actualPath: join(directory, `${name}.actual.png`), diffPath: join(directory, `${name}.diff.png`) };
}

function write(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/**
 * Compares PNG bytes with the baseline at `baselinePath`, creating or updating it according to `update`.
 * Failures write `<name>.actual.png` and `<name>.diff.png` (expected | actual | diff) to `diffDir`.
 */
export function compareScreenshot(actualBytes: Buffer, baselinePath: string, options: CompareOptions = {}): CompareResult {
  const update = resolveUpdateMode(options.update, 'none');
  const failure = failurePaths(baselinePath, options.diffDir);
  const clearFailure = () => {
    rmSync(failure.actualPath, { force: true });
    rmSync(failure.diffPath, { force: true });
  };
  const actual = decode(actualBytes, 'Captured screenshot');
  if (actual.width === 0 || actual.height === 0) throw new Error('Captured screenshot has zero size');

  if (!existsSync(baselinePath)) {
    if (update === 'none') {
      write(failure.actualPath, actualBytes);
      return {
        status: 'missing',
        pass: false,
        baselinePath,
        actualPath: failure.actualPath,
        message: `Baseline ${display(baselinePath)} does not exist. Run Vitest with -u to create it (received image: ${display(failure.actualPath)}).`,
      };
    }
    write(baselinePath, actualBytes);
    clearFailure();
    return { status: 'added', pass: true, baselinePath, message: `Created ${display(baselinePath)}` };
  }

  const expected = decode(readFileSync(baselinePath), `Baseline ${display(baselinePath)}`);
  let diffPixels: number | undefined;
  let mismatch: string;
  let panels: PNG[];
  if (expected.width !== actual.width || expected.height !== actual.height) {
    mismatch = `Size differs from ${display(baselinePath)}: expected ${expected.width}x${expected.height}, received ${actual.width}x${actual.height}.`;
    panels = [expected, actual];
  } else {
    const diff = new PNG({ width: actual.width, height: actual.height });
    diffPixels = pixelmatch(expected.data, actual.data, diff.data, actual.width, actual.height, {
      threshold: options.threshold ?? 0.1,
    });
    const total = actual.width * actual.height;
    const allowed = Math.max(options.maxDiffPixels ?? 0, Math.floor((options.maxDiffPixelRatio ?? 0) * total));
    if (diffPixels <= allowed) {
      clearFailure();
      return { status: 'matched', pass: true, baselinePath, diffPixels, message: `Matches ${display(baselinePath)}` };
    }
    const percent = ((diffPixels / total) * 100).toFixed(2);
    mismatch = `${diffPixels} pixels (${percent}%) differ from ${display(baselinePath)} (allowed: ${allowed}).`;
    panels = [expected, actual, diff];
  }

  if (update === 'all') {
    write(baselinePath, actualBytes);
    clearFailure();
    return { status: 'updated', pass: true, baselinePath, diffPixels, message: `Updated ${display(baselinePath)}` };
  }
  write(failure.actualPath, actualBytes);
  write(failure.diffPath, PNG.sync.write(sideBySide(panels)));
  return {
    status: 'mismatched',
    pass: false,
    baselinePath,
    diffPixels,
    actualPath: failure.actualPath,
    diffPath: failure.diffPath,
    message: `${mismatch} Expected | actual | diff: ${display(failure.diffPath)}`,
  };
}
