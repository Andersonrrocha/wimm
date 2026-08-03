/**
 * Runs the backend's generic-CSV detection and mapper functions directly in
 * **main**, on behalf of the `csv-mapping:propose` / `csv-mapping:apply` IPC
 * handlers registered in `index.ts`.
 *
 * **Why this is a direct function call instead of an HTTP round trip through
 * the embedded API.** `proposeGenericCsvMapping` and `applyGenericCsvMapping`
 * (`apps/api/src/imports/parsers/generic-csv-mapping-detector.ts` and
 * `generic-csv-mapper.ts`) are pure functions -- no database, no NestJS
 * dependency injection, no per-user state. The embedded API
 * (`AppLocalModule`, booted by `local-api.ts`) has no HTTP route for either
 * of them: `ImportsController` only exposes `GET`/`PUT
 * /imports/csv-mapping/:sourceId` for a *confirmed, already-saved* mapping
 * (`CsvSourceMappingService`), and `POST /imports/preview` only ever applies
 * a *saved* mapping, never an arbitrary one the user is still experimenting
 * with (see that controller's doc comments). Inventing a new HTTP endpoint
 * for "parse this buffer under this candidate mapping, but do not save
 * anything" would mean adding request/response DTOs, a controller route,
 * and a service method to `apps/api` for a value that never touches
 * Prisma -- pure ceremony for a pure function. Importing the compiled
 * function directly here, in main, mirrors exactly how `local-api.ts`
 * already imports other pure `@wimm/api` utilities (`applyPendingMigrations`,
 * `createProfile`, ...) straight from `dist/`, for the same reason: main is
 * a real Node process with the full `@wimm/api` package already installed
 * as a dependency, so there is no "backend" to route through for something
 * that keeps no state.
 *
 * **Why `dist/`, never `src/`.** See `local-api.ts`'s module doc comment in
 * full -- `emitDecoratorMetadata` is not implemented by the esbuild
 * transform `electron-vite` uses to bundle this process, and while neither
 * function here is itself a NestJS provider, `generic-csv-mapper.ts` throws
 * `BadRequestException` (`@nestjs/common`) on an invalid mapping; importing
 * that from TypeScript source would still route the whole module graph
 * through the wrong compiler. `dist/*.js` is the same pre-compiled,
 * `tsc`-built output every other `@wimm/api` import in this process uses.
 *
 * **What "validates in main" means for this specific surface.** Neither
 * function above is reachable without a session token or a profile being
 * open (there is no profile/auth concept at all for a pure parse) -- the
 * boundary that matters here is instead "never hand a malformed value
 * straight to a function that assumes its caller already produced a
 * well-typed `GenericCsvMapping`". `mapping` crosses the IPC boundary as
 * `unknown`: a renderer-side bug (or, in principle, a fully compromised
 * renderer) could send anything at all. `assertPlausibleCsvMapping` below
 * is a *shallow* shape check -- every field has the right JavaScript
 * primitive type -- deliberately shallow because the *deep* semantic
 * validation (is `sign.kind` one of the three literals? do `debitColumn`
 * and `creditColumn` differ? do `debitValues`/`creditValues` overlap?) is
 * exactly what `validateMapping` (re-exported by `applyGenericCsvMapping`
 * itself, as its very first step) already checks -- re-encoding that as a
 * second, parallel set of checks here would duplicate it under a different
 * vocabulary instead of reusing it, the same reasoning
 * `SaveCsvSourceMappingDto`'s doc comment already gives for the HTTP
 * boundary. A shape that fails the shallow check here would otherwise crash
 * with a raw `TypeError` (`Cannot read properties of undefined`) somewhere
 * inside `generic-csv-mapper.ts` instead of a clear, named refusal -- the
 * same distinction `profiles:create`'s `typeof name !== 'string'` check
 * draws before ever calling `createProfileAndOpen`.
 */
import { BadRequestException } from '@nestjs/common'
import {
  applyGenericCsvMapping,
  countGenericCsvColumns,
  validateMapping,
  type GenericCsvMapping,
} from '@wimm/api/dist/imports/parsers/generic-csv-mapper'
import { proposeGenericCsvMapping } from '@wimm/api/dist/imports/parsers/generic-csv-mapping-detector'
import type {
  CsvMappingApplyResult,
  CsvMappingProposal,
} from '../shared/csv-mapping-protocol'

/**
 * Turns whatever the renderer sent as `fileBytes` into a real `Buffer`.
 * `Uint8Array` is what actually crosses `contextBridge`'s structured-clone
 * boundary (see `local-api-protocol.ts`'s `SerializedFormDataPart.bytes` for
 * the same pattern, already proven for file uploads through the existing
 * `/imports/preview` path); a bare `ArrayBuffer` is accepted too since
 * `Buffer.from` handles both, and nothing about IPC transport guarantees
 * which one a future caller passes.
 */
function toBuffer(fileBytes: unknown, channel: string): Buffer {
  if (fileBytes instanceof Uint8Array) {
    return Buffer.from(fileBytes)
  }
  if (fileBytes instanceof ArrayBuffer) {
    return Buffer.from(fileBytes)
  }
  throw new Error(`${channel}: fileBytes must be a Uint8Array (or ArrayBuffer).`)
}

/**
 * Shallow type-shape guard -- see the module doc comment for why this is
 * deliberately shallow (the deep, semantic check is `validateMapping`,
 * already invoked by `applyGenericCsvMapping` itself). Throws a plain
 * `Error` naming the first field that does not have the right primitive
 * type; never returns `false`, since there is no legitimate case where a
 * caller wants to keep going after this fails.
 */
function assertPlausibleCsvMapping(
  mapping: unknown,
  channel: string,
): asserts mapping is GenericCsvMapping {
  if (typeof mapping !== 'object' || mapping === null) {
    throw new Error(`${channel}: mapping must be an object.`)
  }
  const m = mapping as Record<string, unknown>

  if (typeof m['delimiter'] !== 'string') {
    throw new Error(`${channel}: mapping.delimiter must be a string.`)
  }
  if (typeof m['hasHeader'] !== 'boolean') {
    throw new Error(`${channel}: mapping.hasHeader must be a boolean.`)
  }
  if (typeof m['encoding'] !== 'string') {
    throw new Error(`${channel}: mapping.encoding must be a string.`)
  }
  if (typeof m['dateColumn'] !== 'number') {
    throw new Error(`${channel}: mapping.dateColumn must be a number.`)
  }
  if (typeof m['descriptionColumn'] !== 'number') {
    throw new Error(`${channel}: mapping.descriptionColumn must be a number.`)
  }
  if (typeof m['decimalSeparator'] !== 'string') {
    throw new Error(`${channel}: mapping.decimalSeparator must be a string.`)
  }
  if (typeof m['dateOrder'] !== 'string') {
    throw new Error(`${channel}: mapping.dateOrder must be a string.`)
  }
  if (typeof m['sign'] !== 'object' || m['sign'] === null) {
    throw new Error(`${channel}: mapping.sign must be an object.`)
  }
}

/**
 * Proposes a `GenericCsvMapping` for a file of unknown origin -- the
 * detected values the mapping screen pre-fills, each with its own
 * confidence and reason (see `CsvMappingProposal`'s doc comment). Never
 * applies anything; this is detection only.
 */
export function proposeCsvMapping(fileBytes: unknown): CsvMappingProposal {
  const buffer = toBuffer(fileBytes, 'csv-mapping:propose')
  return proposeGenericCsvMapping(buffer)
}

/**
 * Applies `mapping` (still unconfirmed -- this is what powers the live
 * preview, not a save) to the file, returning the rows it would import and
 * the warnings it would raise, plus the file's actual column count under
 * this mapping's `delimiter`/`encoding`/`hasHeader` (`countGenericCsvColumns`
 * -- the same value the mapping screen sends as `columnCount` if the user
 * goes on to save this mapping, so "what was previewed" and "what gets
 * persisted" can never drift apart).
 *
 * `occurredAt` is serialized to an ISO string here -- the one shape
 * difference from `CsvParseResult` itself -- since `Date` does not survive
 * the IPC boundary as the same type on both sides the way a `Uint8Array`
 * does; every other renderer-facing date in this app already crosses IPC as
 * a string for the same reason.
 *
 * Throws (a plain `Error`, or `BadRequestException` re-thrown as one) for:
 * an implausibly-shaped `mapping` (`assertPlausibleCsvMapping`), a mapping
 * that fails `validateMapping`'s deeper semantic check (invalid `sign`
 * combination, overlapping debit/credit tokens, ...), a CSV that fails to
 * parse at all under the stated `delimiter`/`encoding`, or a CSV with zero
 * rows the mapping could parse. All of these are real, reportable problems
 * with the *candidate* mapping the user is still editing -- surfaced to the
 * mapping screen as-is, not swallowed.
 */
export function applyCsvMapping(
  fileBytes: unknown,
  mapping: unknown,
): CsvMappingApplyResult {
  const buffer = toBuffer(fileBytes, 'csv-mapping:apply')
  assertPlausibleCsvMapping(mapping, 'csv-mapping:apply')

  // Redundant with the call `applyGenericCsvMapping` itself makes internally,
  // but calling it here too gives a caller (this module's own spec, in
  // particular) a stable place to prove the semantic check runs, without
  // depending on `applyGenericCsvMapping`'s internals staying in this exact
  // order.
  try {
    validateMapping(mapping)
  } catch (e) {
    throw e instanceof BadRequestException ? new Error(e.message) : e
  }

  let result: ReturnType<typeof applyGenericCsvMapping>
  try {
    result = applyGenericCsvMapping(buffer, mapping)
  } catch (e) {
    throw e instanceof BadRequestException ? new Error(e.message) : e
  }

  const columnCount = countGenericCsvColumns(buffer, mapping)

  return {
    rows: result.rows.map((r) => ({
      occurredAt: r.occurredAt.toISOString(),
      signedAmount: r.signedAmount,
      description: r.description,
    })),
    warnings: result.warnings,
    columnCount,
  }
}
