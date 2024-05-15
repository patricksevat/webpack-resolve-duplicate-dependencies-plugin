const path = require('path');

const { getDeduplicatePackagesMap } = require('./get_duplicate_modules_script');
const { createDepMapPluginName, dedupeDepsPluginName } = require('./constants');

const projectRoot = path.resolve(__dirname, '../');

// Reference on the outer scope so both plugins can access it
let resolutionsCache = {};

/**
 * @class CreateDuplicateDependenciesMapPlugin - Webpack plugin to create a map of duplicate dependencies before compilation starts
 * see <rootDir>/temp/duplicatePackagesMap_<strategy>-<yarnLockHash>.json
 * @param options {Object}
 * @param options.strategy {'sameVersion'|'patch|'minor'} - Deduplication strategy
 * @param options.ignore {string[]} - List glob patterns to ignore
 */
class CreateDuplicateDependenciesMapPlugin {
  constructor (options = { strategy: 'sameVersion', ignore: [] }) {
    this.options = options;
    this.validateOptions(options);
  }

  validateOptions (options) {
    this.options.strategy = options.strategy || 'sameVersion';
    this.options.ignore = options.ignore || [];
  }

  apply (compiler) {
    // compiler.hooks.RUN is for yarn build
    compiler.hooks.run.tapAsync(createDepMapPluginName, (compiler, callback) => {
      getDuplicatePackageMapWithCb(this.options, callback);
    });

    // compiler.hooks.WATCHrun is for yarn start
    compiler.hooks.watchRun.tapAsync(createDepMapPluginName, (compiler, callback) => {
      getDuplicatePackageMapWithCb(this.options, callback);
    });
  }
}

/**
 * @function getDuplicatePackageMapWithCb - globs over all package.json files in (nested) node_modules directories
 * and creates a map of package name -> version -> { locations: string[], resolvedVersion: string }
 * @param callback {Function} - Callback to be called after the resolutions cache is populated
 * */
function getDuplicatePackageMapWithCb (options, callback) {
  getDeduplicatePackagesMap(options)
    .then(function (deduplicatedPackagesMap) {
      resolutionsCache = deduplicatedPackagesMap;
      callback();
    });
}

/**
 * @class DedupeDependenciesResolverPlugin - Webpack plugin to resolve dependencies using the resolutions cache
 * */
class DedupeDependenciesResolverPlugin {
  apply (resolver) {
    resolver

      // resolveInPackage has everything we need (to override):
      // request.__innerRequest is the requested module (e.g. uuid, uuid/v4, @babel/core, @babel/core/preset-env)
      // request.__innerRequest_request is the requested module (same as above)
      // request.descriptionFileData is the (parsed) package.json of the requested package
      // request.descriptionFilePath is the path to the package.json of the requested package
      // request.descriptionFileRoot is the path to the root DIRECTORY of the package
      // request.path is the path to the root DIRECTORY of the package
      .getHook('resolveInPackage')
      .tapAsync(dedupeDepsPluginName, (request, resolveContext, callback) => {
        const requestedModule = request.__innerRequest;
        const requestedModuleParts = requestedModule.split('/');
        const packageName = requestedModule.startsWith('@') ? `${requestedModuleParts[0]}/${requestedModuleParts[1]}` : requestedModuleParts[0];
        if (!resolutionsCache[packageName]) {
          callback();
          return;
        }

        const packageVersion = request.descriptionFileData.version;

        const resolutionEntry = resolutionsCache[packageName][packageVersion];

        if (!resolutionEntry) {
          console.log(`[${dedupeDepsPluginName}]: No resolution entry found for ${packageName}@${packageVersion}`);
          callback();
          return;
        }

        /**
         * This is where our override happens
        */

        // We are using the resolved version from the resolutions cache
        // Our resolutionEntry might have version 1.1.0, but depending on the strategy, we might want to use 1.1.x, 1.x.x, etc.
        const resolutionEntryToUse = resolutionsCache[packageName][resolutionEntry.resolvedVersion];

        request.descriptionFilePath = path.join(
          projectRoot,
          resolutionEntryToUse.locations[0],
          'package.json'
        );

        request.descriptionFileRoot = path.join(
          projectRoot,
          resolutionEntryToUse.locations[0]
        );

        request.path = path.join(
          projectRoot,
          resolutionEntryToUse.locations[0]
        );

        // Parsing JSON is expensive, only do so if we have differing versions
        if (request.descriptionFileData.version !== resolutionEntryToUse.packageJson.version) {
          request.descriptionFileData = JSON.parse(resolutionEntryToUse.packageJson);
        }

       /**
        * End of our override
       */

        callback();
      });
  }
}

module.exports = {
  CreateDuplicateDependenciesMapPlugin,
  DedupeDependenciesResolverPlugin
};
