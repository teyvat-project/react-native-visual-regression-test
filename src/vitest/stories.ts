import { join, resolve } from 'node:path';
import { afterAll, describe, test } from 'vitest';
import type { VrtDevice, VrtStory } from '../shared/protocol';
import { compareScreenshot, resolveUpdateMode, type ThresholdOptions, type UpdateMode } from './compare';
import { recordSnapshotResult, vitestUpdateMode } from './matcher';
import { createVrtServer, type VrtServer, type VrtServerOptions } from './server';

export type StoryTagFilter = {
  /** Stories need at least one of these tags. An empty list includes every story. Default: `[]`. */
  include?: string[];
  /** Stories with any of these tags are left out. Default: `['no-vrt']`. */
  exclude?: string[];
  /** Stories with any of these tags are registered as skipped. Default: `[]`. */
  skip?: string[];
};

export type StoryTestsOptions = VrtServerOptions &
  ThresholdOptions & {
    /** Baseline root directory, relative to the working directory. Default: `__vrt__`. */
    snapshotDir?: string;
    /** Subdirectory per device, so that each platform keeps its own baselines. Default: the platform name. */
    snapshotSubdir?(device: VrtDevice): string;
    /** Overrides Vitest's update mode (`-u`). */
    update?: UpdateMode | boolean;
    /** How long to wait for the app to connect before collecting tests. Default: 120 s. */
    connectTimeoutMs?: number;
    /** Time limit for rendering and capturing one story. Default: 30 s. */
    captureTimeoutMs?: number;
    tags?: StoryTagFilter;
    /** Additional filter applied after tags and `parameters.vrt.disable`. */
    filter?(story: VrtStory): boolean;
  };

const hasAny = (tags: string[], wanted: string[]) => wanted.some((tag) => tags.includes(tag));

export function selectStories(stories: VrtStory[], options: Pick<StoryTestsOptions, 'tags' | 'filter'> = {}) {
  const include = options.tags?.include ?? [];
  const exclude = options.tags?.exclude ?? ['no-vrt'];
  const skip = options.tags?.skip ?? [];
  return stories
    .filter((story) => !story.parameters.disable)
    .filter((story) => include.length === 0 || hasAny(story.tags, include))
    .filter((story) => !hasAny(story.tags, exclude))
    .filter((story) => options.filter?.(story) ?? true)
    .map((story) => ({ story, skip: hasAny(story.tags, skip) }));
}

/**
 * Starts the VRT server, waits for the Storybook app to connect, and registers one test per story.
 * Use it with top-level await in a test file:
 *
 * ```ts
 * await defineStoryTests();
 * ```
 */
export async function defineStoryTests(options: StoryTestsOptions = {}): Promise<VrtServer> {
  const server = await createVrtServer(options);
  afterAll(() => server.close());

  let device: VrtDevice;
  let stories: VrtStory[];
  try {
    ({ device, stories } = await server.waitForDevice({ timeoutMs: options.connectTimeoutMs ?? 120_000 }));
  } catch (error) {
    await server.close();
    throw error;
  }

  const selected = selectStories(stories, options);
  const directory = resolve(options.snapshotDir ?? '__vrt__', options.snapshotSubdir?.(device) ?? device.platform);
  const captureTimeoutMs = options.captureTimeoutMs ?? 30_000;

  if (selected.length === 0) {
    test('stories', () => {
      throw new Error(`None of the ${stories.length} stories reported by the ${device.platform} app matched the filters`);
    });
    return server;
  }

  const byTitle = new Map<string, typeof selected>();
  for (const entry of selected) byTitle.set(entry.story.title, [...(byTitle.get(entry.story.title) ?? []), entry]);

  for (const [title, entries] of byTitle) {
    describe(title, () => {
      for (const { story, skip } of entries) {
        const register = skip ? test.skip : test;
        register(story.name, { timeout: captureTimeoutMs + 10_000 }, async ({ annotate }) => {
          const png = await server.captureStory(story.id, { timeoutMs: captureTimeoutMs });
          const baselinePath = join(directory, `${story.id}.png`);
          const result = compareScreenshot(png, baselinePath, {
            threshold: story.parameters.threshold ?? options.threshold,
            maxDiffPixels: story.parameters.maxDiffPixels ?? options.maxDiffPixels,
            maxDiffPixelRatio: story.parameters.maxDiffPixelRatio ?? options.maxDiffPixelRatio,
            update: resolveUpdateMode(options.update, vitestUpdateMode()),
          });
          recordSnapshotResult(result, `${title} > ${story.name}`);
          if (result.pass) return;
          if (result.diffPath) await annotate('expected | actual | diff', { path: result.diffPath, contentType: 'image/png' });
          else if (result.actualPath) await annotate('actual', { path: result.actualPath, contentType: 'image/png' });
          throw new Error(result.message);
        });
      }
    });
  }
  return server;
}
