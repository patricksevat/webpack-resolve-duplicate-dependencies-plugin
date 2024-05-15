const defaultConfig = require('./webpack.config.js');
const { CreateDuplicateDependenciesMapPlugin, DedupeDependenciesResolverPlugin } = require('./dedupe-plugin/DuplicatePackageResolverPlugin.js');
const path = require('path');

const config = {
  ...defaultConfig,
  output: {
    path: path.resolve(__dirname, 'dist-dedupe'),
    filename: 'bundle.js'
  },
  plugins: [new CreateDuplicateDependenciesMapPlugin({ strategy: 'sameVersion' })],
  resolve: {
    plugins: [
      new DedupeDependenciesResolverPlugin()
    ]
  }
};

module.exports = config;