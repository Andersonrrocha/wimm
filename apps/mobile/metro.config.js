/**
 * Metro config for an Expo app inside a pnpm monorepo.
 * - `watchFolders` includes the workspace root so Metro picks up changes
 *   in `packages/shared` without restart.
 * - `nodeModulesPaths` adds the workspace root so transitive deps resolve.
 *
 * Pair with the workspace `.npmrc` (`node-linker=hoisted`) so packages
 * land in flat `node_modules` Metro can walk.
 */
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config
