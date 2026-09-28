import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { VrtStory } from '../src/shared/protocol';
import { selectStories } from '../src/vitest/stories';
import { startFakeAgent, story } from './helpers/fakeAgent';
import { solidPng } from './helpers/png';

describe('selectStories', () => {
  const stories: VrtStory[] = [
    story('a--one', 'A', 'One'),
    story('a--two', 'A', 'Two', { tags: ['dev', 'test', 'no-vrt'] }),
    story('a--three', 'A', 'Three', { parameters: { disable: true } }),
    story('b--one', 'B', 'One', { tags: ['dev', 'test', 'flaky'] }),
    story('b--two', 'B', 'Two', { tags: ['dev'] }),
  ];
  const ids = (selected: ReturnType<typeof selectStories>) => selected.map(({ story, skip }) => `${story.id}${skip ? ' (skip)' : ''}`);

  test('includes everything except no-vrt and disabled stories by default', () => {
    expect(ids(selectStories(stories))).toEqual(['a--one', 'b--one', 'b--two']);
  });

  test('supports include, exclude, skip, and a custom filter', () => {
    expect(ids(selectStories(stories, { tags: { include: ['test'], exclude: [], skip: ['flaky'] } }))).toEqual([
      'a--one',
      'a--two',
      'b--one (skip)',
    ]);
    expect(ids(selectStories(stories, { filter: (entry) => entry.title === 'B' }))).toEqual(['b--one', 'b--two']);
  });
});

describe('defineStoryTests', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const fixture = join(root, 'fixtures', 'story-suite');
  const vitestCli = resolve(root, '..', 'node_modules', 'vitest', 'vitest.mjs');
  const images = new Map<string, Buffer>();
  let port: number;
  let snapshotDir: string;
  let stopAgent: () => Promise<void>;

  const stories = [
    story('button--primary', 'Button', 'Primary', { parameters: { maxDiffPixels: 1 } }),
    story('button--secondary', 'Button', 'Secondary'),
    story('card--flaky', 'Card', 'Flaky', { tags: ['dev', 'test', 'flaky'] }),
    story('card--hidden', 'Card', 'Hidden', { tags: ['dev', 'test', 'no-vrt'] }),
  ];

  type Report = {
    numPassedTests: number;
    numFailedTests: number;
    numPendingTests: number;
    testResults: Array<{ message?: string; assertionResults: Array<{ fullName: string; status: string; failureMessages: string[] }> }>;
  };

  async function runVitest(args: string[] = [], env: Record<string, string> = {}): Promise<Report> {
    const outputFile = join(snapshotDir, 'report.json');
    rmSync(outputFile, { force: true });
    const childEnv: NodeJS.ProcessEnv = { ...process.env, VRT_PORT: String(port), VRT_SNAPSHOT_DIR: snapshotDir, ...env };
    // Vitest also detects CI from provider variables such as GITHUB_ACTIONS, and then never writes new baselines.
    if (!env.CI) {
      delete childEnv.CI;
      delete childEnv.GITHUB_ACTIONS;
    }
    await new Promise<void>((done) => {
      execFile(process.execPath, [vitestCli, 'run', '--root', fixture, '--reporter=json', `--outputFile=${outputFile}`, ...args], { env: childEnv }, () => done());
    });
    return JSON.parse(readFileSync(outputFile, 'utf8')) as Report;
  }

  const results = (report: Report) =>
    Object.fromEntries(report.testResults.flatMap((file) => file.assertionResults.map((test) => [test.fullName, test.status])));

  beforeAll(async () => {
    snapshotDir = mkdtempSync(join(tmpdir(), 'vrt-stories-'));
    port = await new Promise<number>((done) => {
      const probe = createServer().listen(0, '127.0.0.1', () => {
        const { port: free } = probe.address() as { port: number };
        probe.close(() => done(free));
      });
    });
    for (const { id } of stories) images.set(id, solidPng(8, 4, [200, 200, 200]));
    stopAgent = startFakeAgent({ url: `http://127.0.0.1:${port}`, stories, render: (id) => images.get(id)! });
  });

  afterAll(async () => {
    await stopAgent?.();
    rmSync(snapshotDir, { recursive: true, force: true });
  });

  test('registers one test per story, grouped by title, and writes new baselines', async () => {
    const report = await runVitest();
    expect(results(report)).toEqual({
      'Button Primary': 'passed',
      'Button Secondary': 'passed',
      'Card Flaky': 'skipped',
    });
    expect(readFileSync(join(snapshotDir, 'ios', 'button--primary.png'))).toEqual(images.get('button--primary'));
    expect(existsSync(join(snapshotDir, 'ios', 'card--hidden.png'))).toBe(false);
  });

  test('fails with a diff when a story changes, honoring per-story tolerances', async () => {
    images.set('button--primary', solidPng(8, 4, [200, 200, 200], [0, 0, 0]));
    images.set('button--secondary', solidPng(8, 4, [0, 0, 0]));
    const report = await runVitest();
    expect(results(report)).toMatchObject({ 'Button Primary': 'passed', 'Button Secondary': 'failed' });
    const failure = report.testResults[0].assertionResults.find((test) => test.fullName === 'Button Secondary')!;
    expect(failure.failureMessages.join('\n')).toContain('32 pixels (100.00%) differ');
    expect(existsSync(join(snapshotDir, 'ios', '__diffs__', 'button--secondary.diff.png'))).toBe(true);
  });

  test('updates baselines with -u', async () => {
    const report = await runVitest(['-u']);
    expect(report.numFailedTests).toBe(0);
    expect(readFileSync(join(snapshotDir, 'ios', 'button--secondary.png'))).toEqual(images.get('button--secondary'));
    expect(existsSync(join(snapshotDir, 'ios', '__diffs__', 'button--secondary.diff.png'))).toBe(false);
  });

  test('does not write missing baselines on CI', async () => {
    rmSync(join(snapshotDir, 'ios', 'button--primary.png'));
    const report = await runVitest([], { CI: 'true' });
    expect(results(report)).toMatchObject({ 'Button Primary': 'failed', 'Button Secondary': 'passed' });
    expect(existsSync(join(snapshotDir, 'ios', 'button--primary.png'))).toBe(false);
  });
});
