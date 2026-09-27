# react-native-visual-regression-test

Visual regression tests for React Native Storybook stories, run from Vitest.

Each story is rendered in your real Storybook app on an iOS simulator or Android emulator, captured natively as a PNG of just that story, and compared with a baseline image checked into your repository.

```
 Vitest (your machine)                  Storybook app (simulator / emulator)
┌────────────────────────────────┐     ┌──────────────────────────────────────┐
│ defineStoryTests()             │◀────│ startVrtAgent()                      │
│  • one test per story          │hello│  • selects the story in Storybook    │
│  • asks the app for each story │────▶│  • waits for <VrtBoundary> to settle │
│  • compares with __vrt__/*.png │◀────│  • captures it with a native module  │
└────────────────────────────────┘ PNG └──────────────────────────────────────┘
```

- **One test per story.** The story list comes from the running app, so new stories are tested without extra code.
- **Element screenshots.** Only the story's own bounds are captured, not the whole screen.
- **Vitest native.** `vitest -u` updates baselines, CI never writes them, and failures come with an expected | actual | diff image.

## Requirements

| | |
| --- | --- |
| React Native | 0.80 or later with the New Architecture (the native module is a TurboModule) |
| Storybook | `@storybook/react-native` 10 |
| iOS | Simulator or device supported by your React Native version |
| Android | Android 8.0 (API 26) or later. Capturing inside `Modal` needs Android 14 (API 34) |
| Vitest | 4 or later (tested with 5), Node.js 20.19 or later |

## Setup

### 1. Install

```bash
npm install --save-dev react-native-visual-regression-test
```

The package contains native code, so rebuild the app afterwards (`pod install`, then build for iOS and Android).

### 2. Wrap every story

Add the `withVrt` decorator in `.rnstorybook/preview.tsx`. It wraps each story in a `VrtBoundary`, a plain `View` whose bounds are the screenshot bounds.

```tsx
import type { Preview } from '@storybook/react-native';
import { withVrt } from 'react-native-visual-regression-test';

const preview: Preview = {
  decorators: [withVrt],
};

export default preview;
```

### 3. Start the agent in the app

In `.rnstorybook/index.tsx`, start the agent next to the Storybook UI. It connects to Vitest on your machine and does nothing until a test run starts.

```tsx
import { startVrtAgent } from 'react-native-visual-regression-test';
import { view } from './storybook.requires';

const StorybookUIRoot = view.getStorybookUI({
  // Optional: without the on-device UI, stories render at the top of the screen.
  onDeviceUI: false,
  shouldPersistSelection: false,
});

if (__DEV__) {
  startVrtAgent({ view });
}

export default StorybookUIRoot;
```

The agent works with or without the on-device UI, as long as the story is visible on screen.

### 4. Add the test file

```ts
// vrt/stories.test.ts
import { defineStoryTests } from 'react-native-visual-regression-test/vitest';

await defineStoryTests();
```

`defineStoryTests` starts a server on port 8765, waits for the app to connect, and registers one test per story, grouped by story title. Run the tests only in a Node environment (the default), and keep them in their own file or project so that other tests do not wait for a device.

### 5. Run

1. Start Metro and launch the Storybook app on a simulator or emulator.
2. Run `npx vitest run vrt`.

| Situation | Result |
| --- | --- |
| Baseline is missing, local run | Created in `__vrt__/<platform>/<story id>.png` and the test passes |
| Baseline is missing, `CI` is set | The test fails and nothing is written |
| Screenshot differs | The test fails, writing `__diffs__/<story id>.actual.png` and `<story id>.diff.png` (expected, actual, and highlighted differences side by side) next to the baselines |
| `vitest -u` | Differing baselines are overwritten; matching ones are left untouched |

Commit the `__vrt__` directory, and add `__diffs__/` and `.vitest/` (Vitest's copies of attached images) to `.gitignore`. Vitest's snapshot summary counts written, updated, and failed screenshots, and the diff image is attached to failed tests for reporters that show annotations.

## Story options

Per-story options go in `parameters.vrt`:

```tsx
export const Chart: Story = {
  parameters: {
    vrt: {
      settleMs: 500,          // extra wait after the story is ready (the agent default is 100 ms)
      maxDiffPixels: 20,      // allowed number of differing pixels
      maxDiffPixelRatio: 0.01,// or a share of the image; the larger limit applies
      threshold: 0.2,         // pixelmatch color threshold (default 0.1)
      style: { alignSelf: 'stretch' }, // boundary style; the default shrinks to the content
      disable: true,          // leave this story out
    },
  },
};
```

Stories tagged `no-vrt` are left out:

```tsx
export const Loading: Story = { tags: ['no-vrt'] };
```

### Waiting for asynchronous content

The agent captures a story once its `VrtBoundary` has been laid out, two frames have been drawn, and `settleMs` has passed. For content that loads later, such as images, hold the capture with `useVrtPending`:

```tsx
import { useVrtPending } from 'react-native-visual-regression-test';

function Avatar({ uri }: { uri: string }) {
  const [loaded, setLoaded] = useState(false);
  useVrtPending(!loaded); // start with true on the first render
  return <Image source={{ uri }} onLoad={() => setLoaded(true)} style={styles.avatar} />;
}
```

`useVrtPending` does nothing outside a `VrtBoundary`, so it is safe to leave in components. If a story throws while rendering, its test fails right away with the error message.

## Configuration

`defineStoryTests(options)`:

| Option | Default | |
| --- | --- | --- |
| `port` | `8765` | Port of the server the agent connects to |
| `host` | `127.0.0.1` | Listening address. Anything other than loopback requires `token` |
| `token` | none | Shared secret; pass the same value to `startVrtAgent` |
| `platform` | any | Only accept this platform (`ios`, `android`) when several apps are running |
| `snapshotDir` | `__vrt__` | Baseline directory, relative to the working directory |
| `snapshotSubdir(device)` | platform name | Subdirectory per device, for example to separate phones and tablets |
| `tags` | `{ include: [], exclude: ['no-vrt'], skip: [] }` | Story tag filters. An empty `include` means every story |
| `filter(story)` | none | Extra filter on `{ id, title, name, tags, parameters }` |
| `threshold`, `maxDiffPixels`, `maxDiffPixelRatio` | `0.1`, `0`, `0` | Defaults for every story |
| `update` | Vitest's mode | `true`/`'all'`, `'new'`, or `false`/`'none'` to override `-u` and CI detection |
| `connectTimeoutMs` | `120000` | How long to wait for the app to connect |
| `captureTimeoutMs` | `30000` | Time limit per story |

`startVrtAgent(options)`:

| Option | Default | |
| --- | --- | --- |
| `view` | `globalThis.view` | The Storybook view from `storybook.requires` |
| `serverUrl` | see below | URL of the Vitest server |
| `token` | none | Must match the server's token |
| `settleMs` | `100` | Wait after the story is ready and two frames have been drawn |
| `storyTimeoutMs` | `10000` | Time for a story to mount its boundary |
| `selectStory`, `getStories` | Storybook | Replace how stories are selected and listed |
| `log` | `true` | Connection logs (`console.log`, so LogBox does not cover the screen) |

Calling `startVrtAgent` again, for example after Fast Refresh re-runs the entry file, stops the previous agent.

## Connecting the app and Vitest

By default the agent tries `http://localhost:8765` on iOS, and on Android `http://10.0.2.2:8765` (the emulator's alias for your machine) followed by `http://localhost:8765`.

- **iOS simulator**: works out of the box.
- **Android emulator**: works out of the box. Android 17 and later ask for the local network permission on first launch; allow it, or grant it ahead of time on CI:
  ```bash
  adb shell pm grant com.example.app android.permission.ACCESS_LOCAL_NETWORK
  ```
- **Android device over USB**: forward the port with `adb reverse tcp:8765 tcp:8765`.
- **iOS device, or anything on another machine**: listen on the network and use a token:
  ```ts
  await defineStoryTests({ host: '0.0.0.0', token: process.env.VRT_TOKEN });
  ```
  ```tsx
  startVrtAgent({ view, serverUrl: 'http://192.168.0.10:8765', token: 'same-token' });
  ```

The server accepts one device at a time. While a device is connected, others are turned away until it has been idle for a few seconds; reloading the same app simply reconnects. When both the iOS and Android apps are running, pass `platform` to choose one.

Without a token, the server only answers requests addressed to a loopback name (`localhost`, `127.0.0.1`, `10.0.2.2`, …) that carry the agent's protocol header, which keeps web pages from talking to it.

## Writing tests by hand

The building blocks are exported for custom flows:

```ts
import { afterAll, expect, test } from 'vitest';
import { createVrtServer, installVrtMatcher } from 'react-native-visual-regression-test/vitest';

installVrtMatcher({ snapshotDir: '__vrt__' });

const server = await createVrtServer();
afterAll(() => server.close());
const { device } = await server.waitForDevice();

test('primary button', async () => {
  const png = await server.captureStory('button--primary');
  expect(png).toMatchVrtScreenshot(`${device.platform}/button-primary`, { maxDiffPixels: 10 });
});
```

`compareScreenshot(png, baselinePath, options)` compares PNG bytes with a file without Vitest, and `captureView(ref)` captures any mounted view from app code.

## Stable screenshots

- Use the same simulator or emulator model, OS version, scale, appearance, and font size for a baseline set. Baselines are separated by platform; use `snapshotSubdir` to separate more (the connected device is available as `device.model`, `device.osVersion`, `device.scale`, ...).
- Disable animations and blinking cursors in stories, or exclude them with `no-vrt`.
- Load fonts before starting the agent, and hold remote images with `useVrtPending`.
- iOS captures the view hierarchy, so it is not affected by what is drawn over it; transparent areas stay transparent. Android copies the pixels on screen (`PixelCopy`), so the story must be fully visible and not covered, and the background behind transparent areas is included. Keep stories smaller than the screen.

## How it works

1. `defineStoryTests` starts an HTTP server and waits for `POST /hello` from the agent, which reports the device and the story index (with tags and `parameters.vrt`).
2. Each test queues a capture request. The agent receives it through a long-polling `GET /next`, emits Storybook's `setCurrentStory` event, and waits until the `VrtBoundary` for that story id is mounted, laid out, and not held by `useVrtPending`.
3. After two frames and `settleMs`, the native module captures the boundary's view (`drawViewHierarchyInRect` in 8-bit sRGB on iOS, `PixelCopy` on Android) and the agent posts the PNG to `POST /result`.
4. The host compares the PNG with the baseline using [pixelmatch](https://github.com/mapbox/pixelmatch).

If the app reloads during a run, requests it had taken are queued again for the new session. If Vitest restarts, the agent reconnects on its own.

## Example

[`example/`](example) is a React Native 0.87 app with Storybook 10 in lite mode (no on-device UI dependencies):

```bash
pnpm install
cd example
pnpm start            # Metro
pnpm ios              # or: pnpm android
pnpm vrt              # in another terminal; VRT_PLATFORM chooses a platform (pnpm vrt:ios / pnpm vrt:android)
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm test     # unit tests, the agent against the real server, and defineStoryTests through the Vitest CLI
pnpm build
```

## License

MIT
