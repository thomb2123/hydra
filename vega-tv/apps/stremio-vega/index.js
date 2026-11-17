import { AppRegistry, LogBox } from 'react-native';
import { App } from './src/App';
import { registerShaka } from '../../shared/src/player/shaka/registerShaka';

// HLS/DASH (live TV) through Amazon's Vega-patched Shaka Player.
registerShaka((line) => console.log(`[stremio] ${line}`));
import { name as appName } from './app.json';

// Temporary workaround for problem with nested text
// not working currently.
LogBox.ignoreAllLogs();

AppRegistry.registerComponent(appName, () => App);
