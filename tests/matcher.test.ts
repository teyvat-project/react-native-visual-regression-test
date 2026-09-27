import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { installVrtMatcher } from '../src/vitest';
import { assertSnapshotName } from '../src/vitest/matcher';
import { solidPng } from './helpers/png';

const snapshotDir = mkdtempSync(join(tmpdir(), 'vrt-matcher-'));
afterAll(() => rmSync(snapshotDir, { recursive: true, force: true }));

test('toMatchVrtScreenshot creates and then compares a baseline', () => {
  const png = solidPng(2, 2, [0, 128, 0]);
  installVrtMatcher({ snapshotDir, update: 'new' });
  expect(png).toMatchVrtScreenshot('ios/story');
  expect(readFileSync(join(snapshotDir, 'ios', 'story.png'))).toEqual(png);

  installVrtMatcher({ snapshotDir, update: 'none' });
  expect(png).toMatchVrtScreenshot('ios/story');
  expect(() => expect(solidPng(2, 2, [0, 0, 0])).toMatchVrtScreenshot('ios/story')).toThrow('4 pixels (100.00%) differ');
  expect(solidPng(2, 2, [0, 0, 0])).toMatchVrtScreenshot('ios/story', { maxDiffPixels: 4 });
});

test('toMatchVrtScreenshot rejects values that are not PNG bytes and `.not`', () => {
  installVrtMatcher({ snapshotDir });
  expect(() => expect('png').toMatchVrtScreenshot('x')).toThrow(TypeError);
  expect(() => expect(solidPng(1, 1, [0, 0, 0])).not.toMatchVrtScreenshot('x')).toThrow('.not');
});

test.each(['../escape', '/absolute', 'a/../b', 'a//b', '.hidden', ''])('rejects unsafe name %j', (name) => {
  expect(() => assertSnapshotName(name)).toThrow('Invalid screenshot name');
});

test.each(['button--primary', 'ios/button--primary', 'android/v1.2/x_y'])('accepts %j', (name) => {
  expect(() => assertSnapshotName(name)).not.toThrow();
});
