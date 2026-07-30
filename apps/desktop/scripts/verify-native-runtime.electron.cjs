// Tiny CommonJS entry so Electron -- which loads its main-process entry via
// plain Node `require()` and does not understand TypeScript on its own --
// can execute `verify-native-runtime.ts`.
//
// `require('tsx/cjs')` installs a `require` extension handler for `.ts`
// before anything else loads (this line has the side effect of registering
// it; see tsx's own `dist/cjs/index.cjs`). That registration cannot live
// inside `verify-native-runtime.ts` itself -- loading that file already
// requires the hook to exist first, so a `.ts` file cannot bootstrap its
// own loader. `tsx` is not a new dependency: it is already a devDependency
// of `apps/api` and resolves from anywhere in this workspace because this
// repo runs pnpm with `node-linker=hoisted`.
//
// Invoke via:
//   ./node_modules/.bin/electron apps/desktop/scripts/verify-native-runtime.electron.cjs
//
// See verify-native-runtime.ts's module doc comment for the full rationale
// and the complete invocation (ABI selection before and after).
require('tsx/cjs')
require('./verify-native-runtime.ts')
