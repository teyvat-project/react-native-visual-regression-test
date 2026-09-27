import { startVrtAgent } from 'react-native-visual-regression-test';
import { view } from './storybook.requires';

const StorybookUIRoot = view.getStorybookUI({
  onDeviceUI: false,
  shouldPersistSelection: false,
});

if (__DEV__) {
  // Connects to `vitest` on this machine (http://localhost:8765, or 10.0.2.2 from the Android emulator).
  startVrtAgent({ view });
}

export default StorybookUIRoot;
