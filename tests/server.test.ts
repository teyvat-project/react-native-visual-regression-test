import { afterEach, describe, expect, test } from 'vitest';
import { PROTOCOL_HEADER } from '../src/shared/protocol';
import { createVrtServer, type VrtServer } from '../src/vitest/server';
import { startFakeAgent, story, testDevice } from './helpers/fakeAgent';
import { solidPng } from './helpers/png';

let server: VrtServer | undefined;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await server?.close();
  server = undefined;
});

const protocol = { [PROTOCOL_HEADER]: '1', 'Content-Type': 'application/json' };
const hello = (url: string, headers: Record<string, string> = protocol) =>
  fetch(`${url}/hello`, { method: 'POST', headers, body: JSON.stringify({ device: testDevice, stories: [] }) });

describe('request validation', () => {
  test('requires the protocol header, which also keeps browsers from sending simple requests', async () => {
    server = await createVrtServer({ port: 0 });
    const response = await fetch(`${server.url}/next`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: `Missing ${PROTOCOL_HEADER} header` });
  });

  test('explains protocol version mismatches', async () => {
    server = await createVrtServer({ port: 0 });
    const response = await hello(server.url, { ...protocol, [PROTOCOL_HEADER]: '999' });
    expect(response.status).toBe(426);
    expect(((await response.json()) as { error: string }).error).toContain('same react-native-visual-regression-test version');
  });

  test('checks the bearer token when one is configured', async () => {
    server = await createVrtServer({ port: 0, token: 'secret' });
    expect((await hello(server.url)).status).toBe(401);
    expect((await hello(server.url, { ...protocol, Authorization: 'Bearer wrong!' })).status).toBe(401);
    expect((await hello(server.url, { ...protocol, Authorization: 'Bearer secret' })).status).toBe(200);
  });

  test('rejects foreign Host headers when there is no token', async () => {
    server = await createVrtServer({ port: 0 });
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const url = new URL(server!.url);
      const req = request({ host: url.hostname, port: url.port, path: '/hello', method: 'POST', headers: { ...protocol, Host: 'evil.example:8765' } }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(403);
  });

  test('requires a token when listening beyond loopback', async () => {
    await expect(createVrtServer({ port: 0, host: '0.0.0.0' })).rejects.toThrow('token is required');
  });

  test('keeps the connected device while it is active and turns other devices away', async () => {
    server = await createVrtServer({ port: 0, longPollMs: 5_000 });
    const { sessionId } = (await (await hello(server.url)).json()) as { sessionId: string };
    const poll = fetch(`${server.url}/next?session=${sessionId}`, { headers: protocol });
    const android = { ...testDevice, platform: 'android', osVersion: '17' };
    const rejected = await fetch(`${server.url}/hello`, { method: 'POST', headers: protocol, body: JSON.stringify({ device: android, stories: [] }) });
    expect(rejected.status).toBe(423);
    expect(((await rejected.json()) as { error: string }).error).toContain('Another device (ios 27.0');
    // The same device reconnecting (an app reload) takes over.
    expect((await hello(server.url)).status).toBe(200);
    await poll;
  });

  test('only accepts the configured platform', async () => {
    server = await createVrtServer({ port: 0, platform: 'android' });
    const response = await hello(server.url);
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({ error: 'This VRT server only accepts android devices' });
  });

  test('answers /next for unknown sessions with 409 so the agent reconnects', async () => {
    server = await createVrtServer({ port: 0 });
    const response = await fetch(`${server.url}/next?session=stale`, { headers: protocol });
    expect(response.status).toBe(409);
  });
});

describe('captures', () => {
  test('round trips story commands and PNGs', async () => {
    server = await createVrtServer({ port: 0 });
    const stories = [story('button--primary', 'Button', 'Primary')];
    cleanups.push(startFakeAgent({ url: server.url, stories, render: () => solidPng(1, 1, [1, 2, 3]) }));
    const session = await server.waitForDevice({ timeoutMs: 5_000 });
    expect(session).toEqual({ device: testDevice, stories });
    expect(await server.captureStory('button--primary')).toEqual(solidPng(1, 1, [1, 2, 3]));
  });

  test('queues captures requested before the device connects', async () => {
    server = await createVrtServer({ port: 0 });
    const capture = server.captureStory('early', { timeoutMs: 5_000 });
    cleanups.push(startFakeAgent({ url: server.url, stories: [], render: () => solidPng(1, 1, [0, 0, 0]) }));
    await expect(capture).resolves.toBeInstanceOf(Buffer);
  });

  test('delivers commands to a waiting long poll immediately', async () => {
    server = await createVrtServer({ port: 0, longPollMs: 10_000 });
    const { sessionId } = (await (await hello(server.url)).json()) as { sessionId: string };
    const poll = fetch(`${server.url}/next?session=${sessionId}`, { headers: protocol });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const started = Date.now();
    void server.captureStory('story', { timeoutMs: 1_000 }).catch(() => {});
    const { command } = (await (await poll).json()) as { command: { storyId: string } };
    expect(command.storyId).toBe('story');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test('ends idle long polls with no command', async () => {
    server = await createVrtServer({ port: 0, longPollMs: 30 });
    const { sessionId } = (await (await hello(server.url)).json()) as { sessionId: string };
    const response = await fetch(`${server.url}/next?session=${sessionId}`, { headers: protocol });
    expect(await response.json()).toEqual({ command: null });
  });

  test('re-queues a command when the app restarts before answering it', async () => {
    server = await createVrtServer({ port: 0 });
    const first = (await (await hello(server.url)).json()) as { sessionId: string };
    const capture = server.captureStory('story', { timeoutMs: 5_000 });
    const taken = (await (await fetch(`${server.url}/next?session=${first.sessionId}`, { headers: protocol })).json()) as {
      command: { storyId: string };
    };
    expect(taken.command.storyId).toBe('story');
    // The app reloads and connects again; the new session must get the same story.
    cleanups.push(startFakeAgent({ url: server.url, stories: [], render: () => solidPng(2, 2, [9, 9, 9]) }));
    await expect(capture).resolves.toEqual(solidPng(2, 2, [9, 9, 9]));
  });

  test('passes device errors to the caller', async () => {
    server = await createVrtServer({ port: 0 });
    cleanups.push(startFakeAgent({ url: server.url, stories: [], render: () => { throw new Error('boom'); } }));
    await expect(server.captureStory('broken')).rejects.toThrow('Device failed to capture "broken": Error: boom');
  });

  test('times out when no device answers', async () => {
    server = await createVrtServer({ port: 0 });
    await expect(server.captureStory('never-shown', { timeoutMs: 20 })).rejects.toThrow('no device is connected');
    await expect(server.waitForDevice({ timeoutMs: 20 })).rejects.toThrow('No device connected');
  });

  test('rejects pending captures on close', async () => {
    server = await createVrtServer({ port: 0 });
    const capture = server.captureStory('story');
    await server.close();
    await expect(capture).rejects.toThrow('VRT server closed');
    await expect(server.captureStory('again')).rejects.toThrow('closed');
  });
});
