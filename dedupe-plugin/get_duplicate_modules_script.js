const path = require('path');
const crypto = require('crypto');
const fastGlob = require('fast-glob');
const fs = require('fs');
const fsExtra = require('fs-extra');
const semver = require('semver');

const { createDepMapPluginName } = require('./constants');

const projectRoot = path.resolve(__dirname, '../');

/** @typedef {string} PkgVersion */
/** @typedef {string} PkgName */

/**
 * @typedef {Object} DuplicatePackagesCacheVersion
 * @property {string[]} locations - List of paths where the package is found
 * @property {PkgVersion} resolvedVersion - the version to use based on the dedupe strategy
 * */

/**
 * @typedef {Object} DuplicatePackagesCache
 * @property {Record<PkgName, Record<PkgVersion, DuplicatePackagesCacheVersion>>}
 * */

const defaultIgnore = [];

/**
 * @function createDuplicatePackagesMap
 * @param options {Object}
 * @param options.strategy {'sameVersion'|'patch'|'minor'} - Deduplication strategy
 * @param options.ignore {string[]} - List glob patterns to ignore
 * @returns {Promise<DuplicatePackagesCache>} - Cache of package resolutions
 * */
async function getDeduplicatePackagesMap (options) {
  const yarnLockHash = await createYarnLockHash();
  const tempFolder = path.join(projectRoot, 'temp');
  const existingDuplicatePackagesCachePath = path.join(projectRoot, `temp/duplicatePackagesMap_${options.strategy}-${yarnLockHash}.json`);

  if (fs.existsSync(existingDuplicatePackagesCachePath)) {
    console.log(`[${createDepMapPluginName}]: Duplicate dependency map already exists`);
    return JSON.parse(fs.readFileSync(existingDuplicatePackagesCachePath, 'utf8'));
  }

  const allNodeModulePackageJsons = getAllNodeModulePackageJsons(options);
  console.log(`[${createDepMapPluginName}]: Analyzing ${allNodeModulePackageJsons.length} package.jsons`);

  const duplicatePackagesMap = getDuplicateResolutions(allNodeModulePackageJsons);
  console.log(`[${createDepMapPluginName}]: Sanity check: ${sanityCheck(duplicatePackagesMap)} package.jsons`);

  const withResolvedVersions = addResolvedVersions(duplicatePackagesMap, options);

  fsExtra.ensureDirSync(tempFolder);
  fs.writeFileSync(path.join(projectRoot, `temp/duplicatePackagesMap_${options.strategy}-${yarnLockHash}.json`), JSON.stringify(withResolvedVersions, null, 2));

  return duplicatePackagesMap;
}

/**
 * @function getAllNodeModulePackageJsons
 * @param options {Object}
 * @param options.strategy {'sameVersion'|'patch'|'minor'} - Deduplication strategy
 * @param options.ignore {string[]} - List glob patterns to ignore
 * @returns {string[]} - List of all node_modules package.json paths
 * */
function getAllNodeModulePackageJsons (options = { ignore: defaultIgnore }) {
  const ignore = options.ignore || defaultIgnore;
  console.log(`[${createDepMapPluginName}]: Fetching all node_modules package.jsons`);

  const allNodeModulePackageJsons = fastGlob.sync('./**/node_modules/**/package.json', {
    cwd: projectRoot,
    ignore,

    // We are not interested in symlinks (for example when using yarn workspaces)
    followSymbolicLinks: false,
    onlyFiles: true,
  });

  return allNodeModulePackageJsons;
}

/**
 * @function getDuplicateResolutions
 * @param allNodeModulePackageJsons {string[]} - List of all node_modules package.json paths
 * @returns {DuplicatePackagesCache}
 * */
function getDuplicateResolutions (allNodeModulePackageJsons) {
  const duplicatePackagesCache = {};

  for (const packageJsonPath of allNodeModulePackageJsons) {
    const packageJson = require(path.join(projectRoot, packageJsonPath));
    const packageName = packageJson.name;
    const packageVersion = packageJson.version;

    if (!duplicatePackagesCache[packageName]) {
      duplicatePackagesCache[packageName] = {};
    }

    if (!duplicatePackagesCache[packageName][packageVersion]) {
      duplicatePackagesCache[packageName][packageVersion] = {
        locations: [],
        packageJson: JSON.stringify(packageJson, null, 2)
      };
    }

    duplicatePackagesCache[packageName][packageVersion].locations.push(path.dirname(packageJsonPath));
  }

  return duplicatePackagesCache;
}

/**
 * @function addResolvedVersions
 * @param duplicatePackagesMap {DuplicatePackagesCache}
 * @param options {Object}
 * @param options.strategy {'sameVersion'|'patch'|'minor'} - Deduplication strategy
 * */
function addResolvedVersions (duplicatePackagesMap, options) {
  Object.keys(duplicatePackagesMap).forEach((packageName) => {
    const versions = Object.keys(duplicatePackagesMap[packageName]);
    versions.forEach((version) => {
      const versionWithRange = getVersionWithRange(version, options.strategy);

      // Good to know: 0.x.x are always treated as major versions and never deduped
      const bestMatch = semver.maxSatisfying(versions, versionWithRange);
      duplicatePackagesMap[packageName][version].resolvedVersion = bestMatch;
    });
  });

  return duplicatePackagesMap;
}

/**
 * @function getVersionRange
 * @param version {string} - version of the package
 * @param strategy {'sameVersion'|'patch'|'minor'} - Deduplication strategy
 * */
function getVersionWithRange (version, strategy) {
  switch (strategy) {
    case 'patch':
      return `~${version}`;
    case 'minor':
      return `^${version}`;
    case 'sameVersion':
    default:
      return version;
  }
}

/**
 * @function sanityCheck
 * @param {DuplicatePackagesCache} DuplicatePackagesCache
 * @returns {number} - Total number of packages
 * */
function sanityCheck (DuplicatePackagesCache) {
  const totalNumberOfPackages = Object.keys(DuplicatePackagesCache).reduce((acc, packageName) => {
    const versions = DuplicatePackagesCache[packageName];
    Object.keys(versions).forEach((version) => {
      const packagePaths = versions[version].locations;
      acc += packagePaths.length;
    });

    return acc;
  }, 0);

  return totalNumberOfPackages;
}

/**
 * @function createYarnLockHash
 * @returns {Promise<string>} - Hash of yarn.lock file
 */
function createYarnLockHash () {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(path.join(projectRoot, 'yarn.lock'))
      .on('data', (data) => hash.update(data))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

if (require.main === module) {
  getDeduplicatePackagesMap()
  .then(() => {
    console.log('Done');
  });
}

module.exports = {
  getDeduplicatePackagesMap
};
