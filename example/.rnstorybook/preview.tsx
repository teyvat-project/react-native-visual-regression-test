import type { Preview } from '@storybook/react-native';
import { withVrt } from 'react-native-visual-regression-test';

const preview: Preview = {
  // Wraps every story in a VrtBoundary so that the agent can find and capture it.
  decorators: [withVrt],
};

export default preview;
