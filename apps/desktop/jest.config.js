/**
 * Jest config for `apps/desktop`'s main-process code (`src/main/**`) and the
 * renderer's transport-layer logic (`src/renderer/lib/**`). Mirrors
 * `apps/api/jest.config.js` and `packages/shared/jest.config.cjs`: ts-jest
 * against a dedicated `tsconfig.spec.json` (CommonJS, with Jest's globals),
 * kept separate from `tsconfig.node.json`/`tsconfig.web.json` (which drive
 * the real electron-vite build and deliberately exclude `**\/*.spec.ts` --
 * see those files) the same way `apps/api` separates its build tsconfig from
 * `tsconfig.spec.json`.
 *
 * `testEnvironment: 'node'` (not `jsdom`) on purpose: the renderer files
 * covered here (`api-mode.ts`, `local-api-adapter.ts`) are deliberately
 * written with no direct dependency on `window` or the DOM -- every browser
 * global they need (`window.localApi`, in production) is passed in by the
 * caller rather than read directly, specifically so they can be tested this
 * way, without a jsdom dependency this repo does not otherwise need. Full
 * component-level renderer testing (React Testing Library, jsdom, ...) is
 * still not covered here -- that remains future scope, not something this
 * change introduces.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src/main', '<rootDir>/src/renderer/lib'],
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
