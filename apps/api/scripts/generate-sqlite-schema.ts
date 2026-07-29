/**
 * Derive prisma/schema.sqlite.prisma from prisma/schema.prisma.
 *
 * Phase 0 made the datamodel dialect-portable, so the only differences are the
 * datasource provider and the generator output path (the two clients must not
 * write to the same directory). Deriving rather than maintaining means the two
 * schemas cannot drift; assert-schema-parity.ts enforces that the committed file
 * matches what this script produces.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const PRISMA_DIR = join(__dirname, '../prisma')
const SOURCE = join(PRISMA_DIR, 'schema.prisma')
const TARGET = join(PRISMA_DIR, 'schema.sqlite.prisma')

const HEADER = `// GENERATED FILE — do not edit.
// Produced by scripts/generate-sqlite-schema.ts from schema.prisma.
// Run: pnpm --filter @wimm/api run gen:sqlite-schema
`

export function deriveSqliteSchema(source: string): string {
  let out = source
  const before = out

  out = out.replace(
    /(datasource\s+\w+\s*\{[^}]*?provider = )"postgresql"/,
    '$1"sqlite"',
  )
  if (out === before) throw new Error('datasource provider "postgresql" not found')

  const afterProvider = out
  out = out.replace(
    /output( *)= "\.\.\/src\/generated\/prisma"/,
    'output$1= "../src/generated/prisma-sqlite"',
  )
  if (out === afterProvider) throw new Error('generator output path not found')

  return HEADER + out
}

function main(): void {
  writeFileSync(TARGET, deriveSqliteSchema(readFileSync(SOURCE, 'utf8')), 'utf8')
  console.log(`Wrote ${TARGET}`)
}

if (require.main === module) {
  main()
}
