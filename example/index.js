import { AppRegistry } from 'react-native';
import StorybookUIRoot from './.rnstorybook';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => StorybookUIRoot);
