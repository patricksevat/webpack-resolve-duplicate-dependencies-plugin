const defaultConfig = require('./webpack.config.js');
const { CreateDuplicateDependenciesMapPlugin, DedupeDependenciesResolverPlugin } = require('./dedupe-plugin/DuplicatePackageResolverPlugin.js');
const path = require('path');

const config = {
  entry: './app/index.js',
  output: {
    path: path.resolve(__dirname, 'dist-dedupe'),
    filename: 'bundle.js'
  },
  mode: 'development',
  plugins: [new CreateDuplicateDependenciesMapPlugin({ strategy: 'sameVersion' })],
  resolve: {
    plugins: [
      new DedupeDependenciesResolverPlugin()
    ]
  }
};

module.exports = config;