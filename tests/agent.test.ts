import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { solidPng } from './helpers/png';

// The agent runs against the real host server; only the React Native surface is replaced.
const captureTimes: number[] = [];
const nativeCapture = vi.fn(async (tag: number) => {
  captureTimes.push(Date.now());
  return solidPng(2, 2, [tag, 0, 0]).toString('base64');
});
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: '27.0', constants: {} },
  Dimensions: { get: () => ({ width: 402, height: 874, scale: 3, fontScale: 1 }) },
  Appearance: { getColorScheme: () => 'dark' },
  findNodeHandle: (view: { tag: number }) => view.tag,
  TurboModuleRegistry: { get: () => ({ capture: nativeCapture }) },
  StyleSheet: { create: <T>(styles: T) => styles },
  Text: () => null,
  View: () => null,
}));

const { startVrtAgent } = await import('../src/native/agent');
const { createBoundaryState, registerBoundary } = await import('../src/native/registry');
const { createVrtServer } = await import('../src/vitest/server');
type VrtServer = Awaited<ReturnType<typeof createVrtServer>>;

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
});

type Behavior = { tag: number; mount?: boolean; holdMs?: number; releasedAt?: number };

/** Stand-in for the Storybook view: selecting a story mounts a laid-out boundary shortly after. */
function fakeStorybook(behaviors: Record<string, Behavior>) {
  const unregister: Array<() => void> = [];
  const events: unknown[] = [];
  const view = {
    _ready: true,
    _storyIndex: {
      entries: Object.fromEntries(
        Object.keys(behaviors).map((id) => [id, { id, title: 'Button', name: id, type: 'story', tags: ['story'] }]),
      ),
    },
    _idToPrepared: Object.fromEntries(
      Object.keys(behaviors).map((id) => [id, { tags: ['dev', 'test'], parameters: { vrt: { maxDiffPixels: 3, style: {} } } }]),
    ),
    _channel: {
      emit(event: string, payload: { storyId: string }) {
        events.push([event, payload]);
        const behavior = behaviors[payload.storyId];
        if (behavior.mount === false) return;
        setTimeout(() => {
          const state = createBoundaryState();
          state.view = { tag: behavior.tag } as never;
          state.laidOut = true;
          if (behavior.holdMs) {
            state.holds = 1;
            setTimeout(() => {
              state.holds = 0;
              behavior.releasedAt = Date.now();
            }, behavior.holdMs);
          }
          unregister.push(registerBoundary(payload.storyId, state));
        }, 5);
      },
    },
  };
  return { view, events, cleanup: () => unregister.splice(0).forEach((fn) => fn()) };
}

let server: VrtServer | undefined;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await server?.close();
  server = undefined;
  nativeCapture.mockClear();
  captureTimes.length = 0;
});

async function setup(behaviors: Record<string, Behavior>, agentOptions: { storyTimeoutMs?: number } = {}) {
  server = await createVrtServer({ port: 0 });
  const storybook = fakeStorybook(behaviors);
  const stop = startVrtAgent({ serverUrl: server.url, view: storybook.view, log: false, retryMs: 20, settleMs: 0, ...agentOptions });
  cleanups.push(stop, storybook.cleanup);
  return storybook;
}

describe('startVrtAgent', () => {
  test('reports the device and the Storybook stories with their tags and VRT parameters', async () => {
    await setup({ 'button--primary': { tag: 10 } });
    const session = await server!.waitForDevice({ timeoutMs: 5_000 });
    expect(session.device).toMatchObject({ platform: 'ios', osVersion: '27.0', scale: 3, colorScheme: 'dark' });
    expect(session.stories).toEqual([
      { id: 'button--primary', title: 'Button', name: 'button--primary', tags: ['dev', 'test'], parameters: { maxDiffPixels: 3 } },
    ]);
  });

  test('selects the story through the Storybook channel and captures its boundary', async () => {
    const storybook = await setup({ 'button--primary': { tag: 10 }, 'button--secondary': { tag: 20 } });
    expect(await server!.captureStory('button--secondary', { timeoutMs: 5_000 })).toEqual(solidPng(2, 2, [20, 0, 0]));
    expect(await server!.captureStory('button--primary', { timeoutMs: 5_000 })).toEqual(solidPng(2, 2, [10, 0, 0]));
    expect(storybook.events).toEqual([
      ['setCurrentStory', { storyId: 'button--secondary', viewMode: 'story' }],
      ['setCurrentStory', { storyId: 'button--primary', viewMode: 'story' }],
    ]);
  });

  test('reports stories that do not exist', async () => {
    await setup({ a: { tag: 1 } });
    await expect(server!.captureStory('missing--story', { timeoutMs: 5_000 })).rejects.toThrow(
      'Story "missing--story" does not exist in Storybook',
    );
  });

  test('reports stories that never render a boundary', async () => {
    await setup({ bare: { tag: 1, mount: false } }, { storyTimeoutMs: 100 });
    await expect(server!.captureStory('bare', { timeoutMs: 5_000 })).rejects.toThrow('no VrtBoundary with this id was mounted');
  });

  test('waits for useVrtPending holds to be released', async () => {
    const behavior: Behavior = { tag: 7, holdMs: 150 };
    await setup({ held: behavior });
    await server!.captureStory('held', { timeoutMs: 5_000 });
    expect(behavior.releasedAt).toBeDefined();
    expect(captureTimes).toHaveLength(1);
    expect(captureTimes[0]).toBeGreaterThanOrEqual(behavior.releasedAt!);
  });

  test('reconnects after the host server restarts', async () => {
    await setup({ a: { tag: 3 } });
    await server!.waitForDevice({ timeoutMs: 5_000 });
    const port = Number(new URL(server!.url).port);
    await server!.close();
    server = await createVrtServer({ port });
    await server.waitForDevice({ timeoutMs: 5_000 });
    expect(await server.captureStory('a', { timeoutMs: 5_000 })).toEqual(solidPng(2, 2, [3, 0, 0]));
  });
});

test('starting a second agent stops the first one', async () => {
  server = await createVrtServer({ port: 0 });
  const first = fakeStorybook({ a: { tag: 1 } });
  const second = fakeStorybook({ a: { tag: 2 } });
  cleanups.push(first.cleanup, second.cleanup);
  cleanups.push(startVrtAgent({ serverUrl: server.url, view: first.view, log: false, retryMs: 20, settleMs: 0 }));
  await server.waitForDevice({ timeoutMs: 5_000 });
  cleanups.push(startVrtAgent({ serverUrl: server.url, view: second.view, log: false, retryMs: 20, settleMs: 0 }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  await server.captureStory('a', { timeoutMs: 5_000 });
  expect(first.events).toHaveLength(0);
  expect(second.events).toHaveLength(1);
});
