/**
 * Metro config for an Expo app inside a pnpm monorepo.
 * - `watchFolders` includes the workspace root so Metro picks up changes
 *   in `packages/shared` without restart.
 * - `nodeModulesPaths` adds the workspace root so transitive deps resolve.
 *
 * Pair with the workspace `.npmrc` (`node-linker=hoisted`) so packages
 * land in flat `node_modules` Metro can walk.
 *
 * Both arrays merge with Expo's defaults (which now include monorepo paths
 * automatically since SDK 53). Replacing them would lose Expo's resolution
 * of its own internal modules.
 */
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

const existingWatchFolders = config.watchFolders ?? []
if (!existingWatchFolders.includes(workspaceRoot)) {
  config.watchFolders = [...existingWatchFolders, workspaceRoot]
}

const existingNodeModulesPaths = config.resolver.nodeModulesPaths ?? []
const extraNodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
].filter((p) => !existingNodeModulesPaths.includes(p))
config.resolver.nodeModulesPaths = [
  ...existingNodeModulesPaths,
  ...extraNodeModulesPaths,
]

module.exports = config
