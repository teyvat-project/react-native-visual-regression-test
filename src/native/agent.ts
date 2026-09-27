import { Appearance, Dimensions, Platform } from 'react-native';
import {
  DEFAULT_PORT,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type HelloResponse,
  type NextResponse,
  type ResultRequest,
  type VrtCommand,
  type VrtDevice,
  type VrtStory,
} from '../shared/protocol';
import { captureView } from './capture';
import { waitForBoundary } from './registry';
import { storybookAdapter, type StorybookView } from './storybook';

export type VrtAgentOptions = {
  /**
   * Base URL of the Vitest host server. Defaults to `http://localhost:8765` on iOS, and on Android to
   * `http://10.0.2.2:8765` (emulator) with `http://localhost:8765` (`adb reverse`) as a fallback.
   */
  serverUrl?: string;
  /** Must match the `token` given to the host server, if it has one. */
  token?: string;
  /** Storybook React Native view from storybook.requires. Defaults to `globalThis.view`. */
  view?: StorybookView;
  /** Overrides how a story is selected. Defaults to Storybook's SET_CURRENT_STORY event. */
  selectStory?(storyId: string): void | Promise<void>;
  /** Overrides how the story list is read. Defaults to the Storybook story index. */
  getStories?(): VrtStory[] | Promise<VrtStory[]>;
  /** Wait after a story is ready and two frames have been drawn. Default: 100 ms. */
  settleMs?: number;
  /** Maximum time for a story to render its VrtBoundary. Default: 10 s. */
  storyTimeoutMs?: number;
  /** Delay between connection attempts while the host is not running. Default: 1 s. */
  retryMs?: number;
  /** Set to false to silence connection logs. */
  log?: boolean;
};

const ACTIVE_AGENT = '__VRT_AGENT_STOP__';
const HELLO_TIMEOUT_MS = 5_000;
// The server holds /next for up to 15 s, so allow some slack before treating the request as lost.
const NEXT_TIMEOUT_MS = 30_000;
const RESULT_TIMEOUT_MS = 60_000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function defaultServerUrls(): string[] {
  const localhost = `http://localhost:${DEFAULT_PORT}`;
  return Platform.OS === 'android' ? [`http://10.0.2.2:${DEFAULT_PORT}`, localhost] : [localhost];
}

function describeDevice(): VrtDevice {
  const { width, height, scale, fontScale } = Dimensions.get('window');
  const constants = Platform.constants as { Model?: string; Release?: string };
  return {
    platform: Platform.OS,
    osVersion: Platform.OS === 'android' && constants.Release ? constants.Release : String(Platform.Version),
    model: constants.Model,
    width,
    height,
    scale,
    fontScale,
    colorScheme: Appearance.getColorScheme() ?? null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts the on-device worker that renders and captures stories for the Vitest host.
 * Call the returned function to stop it.
 */
export function startVrtAgent(options: VrtAgentOptions = {}): () => void {
  // Fast Refresh can run the entry file again; keep a single agent per JS runtime.
  const registry = globalThis as { [ACTIVE_AGENT]?: () => void };
  registry[ACTIVE_AGENT]?.();
  const storybook = storybookAdapter(() => options.view ?? (globalThis as { view?: StorybookView }).view);
  const getStories = options.getStories ?? storybook.getStories;
  const selectStory = options.selectStory ?? storybook.selectStory;
  const candidates = (options.serverUrl ? [options.serverUrl] : defaultServerUrls()).map((url) => url.replace(/\/+$/, ''));
  const settleMs = options.settleMs ?? 100;
  const storyTimeoutMs = options.storyTimeoutMs ?? 10_000;
  const retryMs = options.retryMs ?? 1_000;
  const stopController = new AbortController();
  let stopped = false;
  let lastLog = '';

  const log = (message: string) => {
    // console.log keeps LogBox from drawing over the screen that is being captured.
    if (options.log !== false && message !== lastLog) console.log(`[VRT] ${message}`);
    lastLog = message;
  };

  const request = async (url: string, init: { method: string; body?: unknown }, timeoutMs: number) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, timeoutMs);
    stopController.signal.addEventListener('abort', abort);
    try {
      const headers: Record<string, string> = { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) };
      if (options.token) headers.Authorization = `Bearer ${options.token}`;
      if (init.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        // DOM typings (pulled in by some apps) declare a different AbortSignal than React Native's fetch.
        signal: controller.signal as RequestInit['signal'],
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new HttpError(response.status, body?.error ?? `VRT server returned HTTP ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
      stopController.signal.removeEventListener('abort', abort);
    }
  };

  const connect = async (): Promise<{ base: string; sessionId: string }> => {
    const body = { device: describeDevice(), stories: await getStories() };
    let lastError: unknown;
    for (const base of candidates) {
      try {
        const response = await request(`${base}/hello`, { method: 'POST', body }, HELLO_TIMEOUT_MS);
        const { sessionId } = (await response.json()) as HelloResponse;
        log(`Connected to ${base} with ${body.stories.length} stories`);
        return { base, sessionId };
      } catch (error) {
        // A server that answered with an error is the right host; report that instead of trying others.
        if (error instanceof HttpError) throw error;
        lastError = error;
      }
    }
    throw new Error(`Waiting for the VRT server at ${candidates.join(' or ')} (${errorMessage(lastError)})`);
  };

  const render = async (command: VrtCommand): Promise<string> => {
    await selectStory(command.storyId);
    const deadline = Date.now() + storyTimeoutMs;
    for (;;) {
      const state = await waitForBoundary(command.storyId, Math.max(0, deadline - Date.now()));
      await nextFrame();
      await nextFrame();
      await delay(Math.max(settleMs, state.settleMs ?? 0));
      // Capture only if nothing was re-held or unmounted while settling.
      const settled = await waitForBoundary(command.storyId, Math.max(0, deadline - Date.now()));
      if (settled === state) return captureView(state.view!);
    }
  };

  const run = async () => {
    let session: { base: string; sessionId: string } | undefined;
    while (!stopped) {
      try {
        session ??= await connect();
        const next = await request(
          `${session.base}/next?session=${encodeURIComponent(session.sessionId)}`,
          { method: 'GET' },
          NEXT_TIMEOUT_MS,
        );
        const { command } = (await next.json()) as NextResponse;
        if (!command) continue;
        const result: ResultRequest = { sessionId: session.sessionId, requestId: command.requestId };
        try {
          result.pngBase64 = await render(command);
        } catch (error) {
          result.error = errorMessage(error);
        }
        await request(`${session.base}/result`, { method: 'POST', body: result }, RESULT_TIMEOUT_MS);
      } catch (error) {
        if (stopped) break;
        // 409 means the host restarted and does not know this session; reconnect right away.
        const reconnectNow = error instanceof HttpError && error.status === 409;
        if (session && !reconnectNow) log(`Disconnected: ${errorMessage(error)}`);
        else if (!reconnectNow) log(errorMessage(error));
        session = undefined;
        if (!reconnectNow) await delay(retryMs);
      }
    }
  };

  const stop = () => {
    stopped = true;
    stopController.abort();
    if (registry[ACTIVE_AGENT] === stop) delete registry[ACTIVE_AGENT];
  };
  registry[ACTIVE_AGENT] = stop;
  void run();
  return stop;
}
