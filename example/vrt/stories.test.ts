import { defineStoryTests } from 'react-native-visual-regression-test/vitest';

// Waits for the Storybook app to connect, then registers one test per story.
// Baselines are written to __vrt__/<platform>/<story id>.png.
await defineStoryTests({
  // Set VRT_PLATFORM when both the iOS and the Android app are running.
  platform: process.env.VRT_PLATFORM,
});
