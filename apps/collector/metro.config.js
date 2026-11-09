const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The contract in the repo-root shared/ folder sits outside this app, so Metro must watch it.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../shared')];

module.exports = config;
