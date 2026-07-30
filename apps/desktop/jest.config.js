/**
 * Jest config for `apps/desktop`'s main-process code (`src/main/**`). Mirrors
 * `apps/api/jest.config.js` and `packages/shared/jest.config.cjs`: ts-jest
 * against a dedicated `tsconfig.spec.json` (CommonJS, with Jest's globals),
 * kept separate from `tsconfig.node.json` (which drives the real
 * electron-vite build and deliberately excludes `**\/*.spec.ts` -- see that
 * file) the same way `apps/api` separates its build tsconfig from
 * `tsconfig.spec.json`.
 *
 * Renderer code is not covered here -- it has no test runner yet, and this
 * task's scope is main-process code only.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src/main'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
}
