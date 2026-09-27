const path = require('path');
const pkg = require('../package.json');

module.exports = {
  project: {
    ios: {
      automaticPodsInstallation: true,
    },
  },
  dependencies: {
    // The library is not installed in node_modules; link it from the repository root.
    [pkg.name]: {
      root: path.join(__dirname, '..'),
      platforms: {
        ios: {},
        android: {},
      },
    },
  },
};
