import { readFileSync, statSync } from 'fs'
import { join } from 'path'

const SOURCE = join(__dirname, '../../prisma/schema.prisma')
const TARGET = join(__dirname, '../../prisma/schema.sqlite.prisma')

/**
 * Deliberately NOT a static top-level `import` for the module under test.
 *
 * Static imports are hoisted to the top of the compiled file, ahead of any
 * other statement — so a `before` snapshot taken "at the top of the file"
 * would actually run *after* the import's side effects, making it useless
 * for proving the import itself didn't write anything.
 *
 * Reading the target file first, then `require`-ing the module as a plain
 * statement, preserves real execution order: if `main()` ever runs at
 * import time again, the mtime/content captured below would move.
 */
const beforeContent = readFileSync(TARGET, 'utf8')
const beforeMtimeMs = statSync(TARGET).mtimeMs

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deriveSqliteSchema } = require('../../scripts/generate-sqlite-schema') as typeof import('../../scripts/generate-sqlite-schema')

describe('generate-sqlite-schema', () => {
  it('is pure: derives the transformed schema without writing to disk on import', () => {
    const derived = deriveSqliteSchema(readFileSync(SOURCE, 'utf8'))

    expect(derived).toContain('provider = "sqlite"')
    expect(derived).not.toContain('provider = "postgresql"')
    expect(derived).toContain('// GENERATED FILE — do not edit.')

    // The real regression check: importing this spec file (and therefore
    // `require`-ing the module under test above) must not have touched
    // prisma/schema.sqlite.prisma on disk.
    expect(readFileSync(TARGET, 'utf8')).toBe(beforeContent)
    expect(statSync(TARGET).mtimeMs).toBe(beforeMtimeMs)
  })

  it('throws when the datasource provider is absent', () => {
    const schema = [
      'datasource db {',
      '  url = env("DATABASE_URL")',
      '}',
      '',
      'generator client {',
      '  output = "../src/generated/prisma"',
      '}',
      '',
    ].join('\n')

    expect(() => deriveSqliteSchema(schema)).toThrow('datasource provider "postgresql" not found')
  })

  it('throws when the generator output path is absent', () => {
    const schema = ['datasource db {', '  provider = "postgresql"', '}', ''].join('\n')

    expect(() => deriveSqliteSchema(schema)).toThrow('generator output path not found')
  })

  it('does not rewrite a provider mention outside the datasource block (regression for the anchored regex)', () => {
    const schema = [
      '// docs example: provider = "postgresql"',
      'datasource db {',
      '  provider = "postgresql"',
      '}',
      '',
      'generator client {',
      '  output = "../src/generated/prisma"',
      '}',
      '',
    ].join('\n')

    const result = deriveSqliteSchema(schema)

    // The comment above the datasource block is untouched...
    expect(result).toContain('// docs example: provider = "postgresql"')
    // ...while the real datasource block was rewritten to sqlite.
    expect(result).toMatch(/datasource db \{\s*provider = "sqlite"\s*\}/)
    // Only one "postgresql" mention survives: the comment.
    expect(result.match(/provider = "postgresql"/g)).toHaveLength(1)
  })

  it('is not idempotent on its own output: re-running it throws rather than silently no-op or corrupt (documents current behavior)', () => {
    const once = deriveSqliteSchema(readFileSync(SOURCE, 'utf8'))

    expect(() => deriveSqliteSchema(once)).toThrow('datasource provider "postgresql" not found')
  })
})
