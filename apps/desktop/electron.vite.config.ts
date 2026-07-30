import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        // `@wimm/api` must never be bundled into the main process.
        // electron-vite bundles main with esbuild/rollup, and esbuild's
        // TypeScript-decorator transform does not implement
        // `emitDecoratorMetadata` -- NestJS dependency injection depends
        // entirely on that metadata. Bundling `@wimm/api`'s TypeScript
        // source through this pipeline would build cleanly and then fail at
        // runtime with unresolvable providers. `include` here is belt and
        // suspenders on top of `@wimm/api` already being a `dependencies`
        // entry in package.json (which `externalizeDepsPlugin` also reads):
        // this line keeps the exclusion true even if that dependency entry
        // is ever moved or removed by accident, since losing it fails
        // silently at runtime, not at build time. The regex
        // `externalizeDepsPlugin` derives from this list also covers every
        // `@wimm/api/dist/...` subpath import, not just the bare specifier.
        // See `src/main/local-api.ts`'s module doc comment for the full
        // story.
        include: ['@wimm/api'],
      }),
    ],
    build: {
      lib: {
        entry: resolve('src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('src/preload/index.ts'),
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
        '@wimm/shared': resolve('../../packages/shared/src/index.ts'),
      },
    },
  },
})
