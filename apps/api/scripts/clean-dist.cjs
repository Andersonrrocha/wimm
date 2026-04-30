const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

try {
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true })
} catch (e) {
  if (e && e.code !== 'ENOENT') throw e
}

for (const f of ['tsconfig.tsbuildinfo', 'tsconfig.build.tsbuildinfo']) {
  try {
    fs.unlinkSync(path.join(root, f))
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e
  }
}
