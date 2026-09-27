import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, test } from 'vitest';
import { compareScreenshot, resolveUpdateMode } from '../src/vitest/compare';
import { solidPng } from './helpers/png';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function baseline(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vrt-compare-'));
  dirs.push(dir);
  return join(dir, 'ios', 'button--primary.png');
}
const red = solidPng(4, 4, [255, 0, 0]);
const blue = solidPng(4, 4, [0, 0, 255]);

describe('missing baseline', () => {
  test('fails without writing a baseline in `none` mode and keeps the received image', () => {
    const path = baseline();
    const result = compareScreenshot(red, path);
    expect(result).toMatchObject({ status: 'missing', pass: false });
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(result.actualPath!)).toEqual(red);
    expect(result.message).toContain('-u');
  });

  test.each(['new', 'all'] as const)('is created in `%s` mode', (update) => {
    const path = baseline();
    expect(compareScreenshot(red, path, { update })).toMatchObject({ status: 'added', pass: true });
    expect(readFileSync(path)).toEqual(red);
  });
});

describe('existing baseline', () => {
  test('matches identical pixels even when the PNG encoding differs', () => {
    const path = baseline();
    compareScreenshot(red, path, { update: 'new' });
    const reencoded = PNG.sync.write(PNG.sync.read(red), { deflateLevel: 1 });
    expect(compareScreenshot(reencoded, path)).toMatchObject({ status: 'matched', pass: true, diffPixels: 0 });
  });

  test('writes the received image and an expected | actual | diff composite on mismatch', () => {
    const path = baseline();
    compareScreenshot(red, path, { update: 'new' });
    const result = compareScreenshot(blue, path);
    expect(result).toMatchObject({ status: 'mismatched', pass: false, diffPixels: 16 });
    expect(result.message).toContain('16 pixels (100.00%) differ');
    expect(readFileSync(result.actualPath!)).toEqual(blue);
    const composite = PNG.sync.read(readFileSync(result.diffPath!));
    expect([composite.width, composite.height]).toEqual([4 * 3 + 8 * 2, 4]);
    expect(readFileSync(path)).toEqual(red);
  });

  test('`new` mode never overwrites an existing baseline', () => {
    const path = baseline();
    compareScreenshot(red, path, { update: 'new' });
    expect(compareScreenshot(blue, path, { update: 'new' }).pass).toBe(false);
    expect(readFileSync(path)).toEqual(red);
  });

  test('`all` mode overwrites a mismatching baseline and removes old failure files', () => {
    const path = baseline();
    compareScreenshot(red, path, { update: 'new' });
    const failed = compareScreenshot(blue, path);
    expect(compareScreenshot(blue, path, { update: 'all' })).toMatchObject({ status: 'updated', pass: true });
    expect(readFileSync(path)).toEqual(blue);
    expect(existsSync(failed.diffPath!)).toBe(false);
    expect(existsSync(failed.actualPath!)).toBe(false);
  });

  test('`all` mode leaves a matching baseline untouched', () => {
    const path = baseline();
    compareScreenshot(red, path, { update: 'new' });
    const reencoded = PNG.sync.write(PNG.sync.read(red), { deflateLevel: 1 });
    expect(compareScreenshot(reencoded, path, { update: 'all' }).status).toBe('matched');
    expect(readFileSync(path)).toEqual(red);
  });

  test('reports size changes with both images side by side', () => {
    const path = baseline();
    compareScreenshot(red, path, { update: 'new' });
    const result = compareScreenshot(solidPng(6, 2, [255, 0, 0]), path);
    expect(result).toMatchObject({ status: 'mismatched', pass: false });
    expect(result.message).toContain('expected 4x4, received 6x2');
    const composite = PNG.sync.read(readFileSync(result.diffPath!));
    expect([composite.width, composite.height]).toEqual([4 + 8 + 6, 4]);
  });

  test('removes stale failure images after a later pass', () => {
    const path = baseline();
    compareScreenshot(red, path, { update: 'new' });
    const failed = compareScreenshot(blue, path);
    compareScreenshot(red, path);
    expect(existsSync(failed.diffPath!)).toBe(false);
  });
});

describe('tolerances', () => {
  const oneDot = solidPng(10, 10, [255, 255, 255], [0, 0, 0]);
  const white = solidPng(10, 10, [255, 255, 255]);

  test('maxDiffPixels allows a fixed number of pixels', () => {
    const path = baseline();
    compareScreenshot(white, path, { update: 'new' });
    expect(compareScreenshot(oneDot, path).pass).toBe(false);
    expect(compareScreenshot(oneDot, path, { maxDiffPixels: 1 }).pass).toBe(true);
  });

  test('maxDiffPixelRatio allows a share of the image', () => {
    const path = baseline();
    compareScreenshot(white, path, { update: 'new' });
    expect(compareScreenshot(oneDot, path, { maxDiffPixelRatio: 0.005 }).pass).toBe(false);
    expect(compareScreenshot(oneDot, path, { maxDiffPixelRatio: 0.01 }).pass).toBe(true);
  });

  test('threshold ignores small color changes', () => {
    const path = baseline();
    compareScreenshot(white, path, { update: 'new' });
    const almostWhite = solidPng(10, 10, [255, 255, 255], [250, 250, 250]);
    expect(compareScreenshot(almostWhite, path).pass).toBe(true);
    expect(compareScreenshot(almostWhite, path, { threshold: 0 }).pass).toBe(false);
  });
});

test('rejects bytes that are not PNG', () => {
  const path = baseline();
  expect(() => compareScreenshot(Buffer.from('nope'), path)).toThrow('Captured screenshot is not a valid PNG');
});

test('resolveUpdateMode maps booleans and falls back', () => {
  expect(resolveUpdateMode(true, 'none')).toBe('all');
  expect(resolveUpdateMode(false, 'all')).toBe('none');
  expect(resolveUpdateMode(undefined, 'new')).toBe('new');
  expect(resolveUpdateMode('new', 'all')).toBe('new');
});
