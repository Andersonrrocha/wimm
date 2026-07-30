/**
 * Root-level jest config, scoped only to `scripts/**`. This repo's real test
 * suites live per-workspace-package (`apps/api`, `packages/shared`) and run
 * through `turbo run test`; `scripts/select-native-abi.ts` lives at the repo
 * root by design (see its doc comment), outside any workspace package, so it
 * needs its own minimal runner rather than being folded into one of those.
 *
 * Run with: `npx jest --config jest.config.js` from the repo root.
 */
/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/scripts'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.scripts.json',
      },
    ],
  },
  testEnvironment: 'node',
}
