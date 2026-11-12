// Metro configuration. The apps share code in ../../shared; Metro must watch
// that folder and resolve its imports from this app's node_modules only, so it
// never picks up unrelated packages from parent directories.
const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const shared = path.resolve(__dirname, '../../shared');
const appModules = path.resolve(__dirname, 'node_modules');

const config = {
  watchFolders: [shared],
  resolver: {
    nodeModulesPaths: [appModules],
    disableHierarchicalLookup: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
