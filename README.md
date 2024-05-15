# DuplicatePackageResolverPlugin

This repo is an example how you can use a [resolver plugin](https://webpack.js.org/api/resolvers/)
to deduplicate dependencies.

Duplicate dependencies can happen when your package manager is hoisting a certain version, while other
parts of your workspace depend on a different version.

## Problem statement and default behavior

This repo shows a minimal example where:

* `package.json` depends on `lodash@4.17.12`
* `packages/featureA/package.json` depends on `lodash@3`
* `packages/featureB/package.json` depends on `lodash@3`

We end up with 3 versions of lodash once we run `yarn install` (FYI I'm using yarn classic, but the mechanism should be same for yarn berry, pnpm, npm workspaces, etc):

* `node_modules/lodash`: 4.17.12
* `packages/featureA/node_modules/lodash`: 3.10.1
* `packages/featureB/node_modules/lodash`: 3.10.1

Unfortunately, webpack does not understand that `packages/featureA/node_modules/lodash` and `packages/featureB/node_modules/lodash` *are the same package*,
so we end up bundling the same version twice!

This default behavior is show here when running `yarn build` which outputs to `dist/bundle.js`. In that bundle we end up with 3 versions of lodash.

## The plugins

To combat this problem, this repo has 2 plugins:

### `CreateDuplicateDependenciesMapPlugin`

This plugin loops over all `package.json` files in `./**/node_modules` to detect all available dependencies.
It then creates a map with the following structure:

```json
{
  "lodash": {
    "4.17.21": {
      "locations": [
        "node_modules/lodash"
      ],
      "packageJson": "...", // omitted for brevity
      "resolvedVersion": "4.17.21"
    },
    "3.10.1": {
      "locations": [
        "packages/featureA/node_modules/lodash",
        "packages/featureB/node_modules/lodash"
      ],
      "packageJson": "...", // omitted for brevity
      "resolvedVersion": "3.10.1"
    }
  }
}  
```

The creation of this map is a blocking actions prior to the compilation starts. To prevent slowness, it writes the map to disk using a hash of `yarn.lock`, so it will not regenerates unless a different dedupe strategy is chosen, or the lock file changed.

The plugin takes an option object:

```javascript
new CreateDuplicateDependenciesMapPlugin({ strategy: 'sameVersion', ignored: ['./a_directory_that_should_not_be_crawled'] })
```

There are 3 possible strategies: 
* `'sameVersion'`: this is the safest, only exact versions will de deduplicated
* `'patch'`: `1.1.1` and `1.1.2` would both resolve to `1.1.2` (this is equivalent to the `~` version range)
* `'minor'`: `1.1.0` and `1.3.3` would both resolve to `1.3.3` (this is equivalent to the `^` version range)

Good to know `0.x.x` versions are considered breaking changes so will only be deduped if they are exactly the same. `'patch'` and `'minor'` have no power here.

### `DedupeDependenciesResolverPlugin`

This is a **RESOLVER PLUGIN** which means you'll need to add it to the [`resolve.plugins`](https://webpack.js.org/configuration/resolve/#resolveplugins) configuration.

It taps into Webpack's [enhanced-resolve](https://github.com/webpack/enhanced-resolve/) hooks to override the dependency resolution using the dependency map.

If you are interested in details, I recommend reading the source code (both of the plugin and of `enhanced-resolve`).

To be honest, I'm not sure if this is the most elegant way, but it works well for our large repo (>10k modules, >10k dependencies)

## Dedupe example

`yarn build:dedupe` uses the `webpack.dedupe.config.js` file.

You can compare `dist-dedupe/bundle.js` with `dist/bundle.js`

You'll see that the dedupe bundle only bundles `lodash@3.10.1` once, whereas `dist/bundle.js` bundles `lodash@3.10.1` twice.

------

That's all, I hope it helps make your build smaller! Do drop me a line on [Twitter/X](https://twitter.com/_Sevat) if it helped you out.

PS: I intentionally do not make this an npm package as I'm not sure which edge cases are not covered. You are free to copy and modify the code in your repo and adjust it to your needs.
