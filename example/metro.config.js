const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');
const { withStorybook } = require('@storybook/react-native/metro/withStorybook');

const root = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);

// Resolve the library from the repository root, using its TypeScript sources.
config.watchFolders = [root];
config.resolver.extraNodeModules = { '@natsuneko-laboratory/react-native-visual-regression-test': root };
config.resolver.unstable_conditionNames = [
  ...config.resolver.unstable_conditionNames,
  'react-native-visual-regression-test-source',
];

module.exports = withStorybook(config, {
  // Lite mode leaves out the on-device UI and its native dependencies (reanimated etc.).
  liteMode: true,
});
