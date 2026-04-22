/**
 * Resolves @prisma/client to the generated client under dist/ at runtime.
 * `nest start --watch` emits `require("@prisma/client")` without running
 * tsc-alias (unlike `pnpm run build`), so Node would otherwise load the
 * stub package and fail with "Cannot find module '.prisma/client/default'".
 */
const { join } = require('path')
const { register } = require('tsconfig-paths')

register({
  baseUrl: join(__dirname, '..'),
  paths: {
    '@prisma/client': ['dist/generated/prisma/client'],
  },
})
