/**
 * Ensures dist/main.js exists before `nest start --watch`.
 * Avoids MODULE_NOT_FOUND when tsc incremental/watch skips emit or dist was removed.
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const mainJs = path.join(root, 'dist', 'main.js')

if (fs.existsSync(mainJs)) {
  process.exit(0)
}

for (const f of ['tsconfig.tsbuildinfo', 'tsconfig.build.tsbuildinfo']) {
  try {
    fs.unlinkSync(path.join(root, f))
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e
  }
}

const r = spawnSync('pnpm', ['exec', 'nest', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.exit(r.status === null ? 1 : r.status)
