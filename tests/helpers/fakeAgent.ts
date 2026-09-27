import { PROTOCOL_HEADER, PROTOCOL_VERSION, type VrtDevice, type VrtStory } from '../../src/shared/protocol';

export const testDevice: VrtDevice = {
  platform: 'ios',
  osVersion: '27.0',
  width: 402,
  height: 874,
  scale: 3,
  fontScale: 1,
  colorScheme: 'light',
};

export function story(id: string, title: string, name: string, extra: Partial<VrtStory> = {}): VrtStory {
  return { id, title, name, tags: ['dev', 'test'], parameters: {}, ...extra };
}

type Options = {
  url: string;
  token?: string;
  stories: VrtStory[];
  render(storyId: string): Buffer | Promise<Buffer>;
};

/** Minimal protocol client used to drive the host side without a device. */
export function startFakeAgent({ url, token, stories, render }: Options): () => Promise<void> {
  const controller = new AbortController();
  const headers: Record<string, string> = { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION), 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const post = (path: string, body: unknown) =>
    fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });

  const loop = (async () => {
    while (!controller.signal.aborted) {
      try {
        const hello = await post('/hello', { device: testDevice, stories });
        const { sessionId } = (await hello.json()) as { sessionId: string };
        for (;;) {
          const next = await fetch(`${url}/next?session=${sessionId}`, { headers, signal: controller.signal });
          if (next.status === 409) break;
          const { command } = (await next.json()) as { command: { requestId: string; storyId: string } | null };
          if (!command) continue;
          try {
            const png = await render(command.storyId);
            await post('/result', { sessionId, requestId: command.requestId, pngBase64: png.toString('base64') });
          } catch (error) {
            await post('/result', { sessionId, requestId: command.requestId, error: String(error) });
          }
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  })();

  return async () => {
    controller.abort();
    await loop;
  };
}
