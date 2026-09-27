import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DEFAULT_PORT,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type HelloRequest,
  type ResultRequest,
  type VrtCommand,
  type VrtDevice,
  type VrtStory,
} from '../shared/protocol';

export type VrtServerOptions = {
  /** TCP port. Default: 8765, which is what the agent uses unless `serverUrl` is set. Use 0 for a random port. */
  port?: number;
  /** Interface to listen on. Default: 127.0.0.1. Anything other than loopback requires `token`. */
  host?: string;
  /** Shared secret the agent must send. Required when `host` is not a loopback address. */
  token?: string;
  /** How long an idle `/next` request is held open. Default: 15 s. */
  longPollMs?: number;
  /** Only accept agents on this platform (`ios`, `android`), for when several apps are running. */
  platform?: string;
};

export type VrtSession = { device: VrtDevice; stories: VrtStory[] };

export type VrtServer = {
  readonly url: string;
  /** The connected device and its stories, once an agent has connected. */
  readonly session: VrtSession | undefined;
  /** Resolves when an agent connects (immediately if one already has). */
  waitForDevice(options?: { timeoutMs?: number }): Promise<VrtSession>;
  /** Asks the device to render a story and resolves with its PNG bytes. */
  captureStory(storyId: string, options?: { timeoutMs?: number }): Promise<Buffer>;
  close(): Promise<void>;
};

type Pending = {
  command: VrtCommand;
  resolve(png: Buffer): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

type Waiter = (command: VrtCommand | null) => void;

const MAX_BODY_BYTES = 64 * 1024 * 1024;
// A session without requests for this long no longer blocks other devices from connecting.
const SESSION_IDLE_MS = 5_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
// Host names the device uses to reach a loopback server: emulator aliases and adb reverse.
const ALLOWED_HOST_HEADERS = new Set(['127.0.0.1', 'localhost', '[::1]', '10.0.2.2', '10.0.3.2']);

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new RequestError(413, 'Request body is too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new RequestError(400, 'Request body is not valid JSON');
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function sameSecret(actual: string | undefined, expected: string): boolean {
  const a = Buffer.from(actual ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function describeDevice(device: VrtDevice): string {
  return [device.platform, device.osVersion, device.model, `${device.width}x${device.height}@${device.scale}x`].filter(Boolean).join(' ');
}

function hostName(header: string | undefined): string {
  if (!header) return '';
  return header.startsWith('[') ? header.slice(0, header.indexOf(']') + 1) : header.split(':')[0];
}

/** Starts the HTTP server that the on-device agent connects to. */
export async function createVrtServer(options: VrtServerOptions = {}): Promise<VrtServer> {
  const host = options.host ?? '127.0.0.1';
  const token = options.token || undefined;
  const loopback = LOOPBACK_HOSTS.has(host);
  if (!loopback && !token) {
    throw new Error(`createVrtServer: a token is required when listening on ${host}. Pass the same token to startVrtAgent.`);
  }
  const longPollMs = options.longPollMs ?? 15_000;

  const queue: VrtCommand[] = [];
  const pending = new Map<string, Pending>();
  const inFlight = new Set<string>();
  const waiters = new Set<Waiter>();
  const deviceWaiters = new Set<(session: VrtSession) => void>();
  let session: (VrtSession & { id: string; key: string }) | undefined;
  let lastSeen = 0;
  const sessionAlive = () => waiters.size > 0 || inFlight.size > 0 || Date.now() - lastSeen < SESSION_IDLE_MS;
  let closed = false;

  const dispatch = () => {
    for (const waiter of waiters) {
      const command = queue.shift();
      if (!command) return;
      waiters.delete(waiter);
      inFlight.add(command.requestId);
      waiter(command);
    }
  };

  const takeCommand = (): VrtCommand | undefined => {
    const command = queue.shift();
    if (command) inFlight.add(command.requestId);
    return command;
  };

  const handleHello = async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readJson<HelloRequest>(request);
    if (!body?.device || !Array.isArray(body.stories)) throw new RequestError(400, 'Invalid hello payload');
    if (options.platform && body.device.platform !== options.platform) {
      throw new RequestError(423, `This VRT server only accepts ${options.platform} devices`);
    }
    const key = describeDevice(body.device);
    // The same device connecting again is an app reload; a different device must wait for the current one.
    if (session && session.key !== key && sessionAlive()) {
      throw new RequestError(423, `Another device (${session.key}) is connected to this VRT server`);
    }
    // A new session means the app restarted. Commands it had taken will never be answered, so queue them again.
    const retry = [...inFlight].map((id) => pending.get(id)?.command).filter((command): command is VrtCommand => !!command);
    inFlight.clear();
    queue.unshift(...retry);
    session = { id: randomUUID(), key, device: body.device, stories: body.stories };
    lastSeen = Date.now();
    for (const waiter of waiters) waiter(null);
    waiters.clear();
    for (const notify of deviceWaiters) notify(session);
    deviceWaiters.clear();
    send(response, 200, { sessionId: session.id });
  };

  const handleNext = (url: URL, response: ServerResponse) => {
    if (!session || url.searchParams.get('session') !== session.id) throw new RequestError(409, 'Unknown session; send /hello again');
    lastSeen = Date.now();
    const command = takeCommand();
    if (command || closed) {
      send(response, 200, { command: command ?? null });
      return;
    }
    const waiter: Waiter = (next) => {
      clearTimeout(timer);
      lastSeen = Date.now();
      send(response, 200, { command: next });
    };
    const timer = setTimeout(() => {
      waiters.delete(waiter);
      lastSeen = Date.now();
      send(response, 200, { command: null });
    }, longPollMs);
    waiters.add(waiter);
    response.once('close', () => {
      if (waiters.delete(waiter)) clearTimeout(timer);
    });
  };

  const handleResult = async (request: IncomingMessage, response: ServerResponse) => {
    const result = await readJson<ResultRequest>(request);
    if (!session || result.sessionId !== session.id) throw new RequestError(409, 'Unknown session; send /hello again');
    lastSeen = Date.now();
    const waiting = typeof result.requestId === 'string' ? pending.get(result.requestId) : undefined;
    if (!waiting) {
      // The capture timed out on the host side already.
      send(response, 200, {});
      return;
    }
    pending.delete(result.requestId);
    inFlight.delete(result.requestId);
    clearTimeout(waiting.timer);
    if (result.error) {
      waiting.reject(new Error(`Device failed to capture "${waiting.command.storyId}": ${result.error}`));
    } else if (typeof result.pngBase64 === 'string' && result.pngBase64.length > 0) {
      waiting.resolve(Buffer.from(result.pngBase64, 'base64'));
    } else {
      waiting.reject(new Error(`Device returned no PNG for "${waiting.command.storyId}"`));
    }
    send(response, 200, {});
  };

  const server = createServer(async (request, response) => {
    try {
      const version = request.headers[PROTOCOL_HEADER];
      if (version === undefined) throw new RequestError(400, `Missing ${PROTOCOL_HEADER} header`);
      if (version !== String(PROTOCOL_VERSION)) {
        throw new RequestError(
          426,
          `Protocol mismatch: agent speaks version ${version}, host speaks ${PROTOCOL_VERSION}. ` +
            'Use the same react-native-visual-regression-test version in the app and the tests.',
        );
      }
      if (token) {
        if (!sameSecret(request.headers.authorization, `Bearer ${token}`)) throw new RequestError(401, 'Invalid VRT token');
      } else if (!ALLOWED_HOST_HEADERS.has(hostName(request.headers.host))) {
        // Without a token, only accept loopback host names to block DNS rebinding from web pages.
        throw new RequestError(403, `Host ${request.headers.host} is not allowed without a token`);
      }

      const url = new URL(request.url ?? '/', 'http://localhost');
      const route = `${request.method} ${url.pathname}`;
      if (route === 'POST /hello') await handleHello(request, response);
      else if (route === 'GET /next') handleNext(url, response);
      else if (route === 'POST /result') await handleResult(request, response);
      else throw new RequestError(404, 'Not found');
    } catch (error) {
      const status = error instanceof RequestError ? error.status : 500;
      send(response, status, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? DEFAULT_PORT, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const urlHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;

  return {
    url: `http://${urlHost}:${address.port}`,
    get session() {
      return session && { device: session.device, stories: session.stories };
    },
    waitForDevice({ timeoutMs = 60_000 } = {}) {
      if (session) return Promise.resolve({ device: session.device, stories: session.stories });
      if (closed) return Promise.reject(new Error('VRT server is closed'));
      return new Promise<VrtSession>((resolve, reject) => {
        const notify = (connected: VrtSession) => {
          clearTimeout(timer);
          resolve({ device: connected.device, stories: connected.stories });
        };
        const timer = setTimeout(() => {
          deviceWaiters.delete(notify);
          reject(new Error(
            `No device connected to the VRT server within ${timeoutMs} ms. ` +
              'Start the Storybook app with startVrtAgent() and check that it can reach the host.',
          ));
        }, timeoutMs);
        deviceWaiters.add(notify);
      });
    },
    captureStory(storyId, { timeoutMs = 30_000 } = {}) {
      if (closed) return Promise.reject(new Error('VRT server is closed'));
      if (!storyId) return Promise.reject(new Error('storyId must not be empty'));
      const command: VrtCommand = { requestId: randomUUID(), storyId };
      return new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(command.requestId);
          inFlight.delete(command.requestId);
          const index = queue.indexOf(command);
          if (index >= 0) queue.splice(index, 1);
          reject(new Error(
            session
              ? `Timed out after ${timeoutMs} ms waiting for the device to capture "${storyId}".`
              : `Timed out after ${timeoutMs} ms waiting for "${storyId}": no device is connected.`,
          ));
        }, timeoutMs);
        pending.set(command.requestId, { command, resolve, reject, timer });
        queue.push(command);
        dispatch();
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const waiting of pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error('VRT server closed'));
      }
      pending.clear();
      queue.length = 0;
      for (const waiter of waiters) waiter(null);
      waiters.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // Keep-alive sockets and aborted requests would otherwise hold close() open for seconds.
        server.closeAllConnections();
      });
    },
  };
}
