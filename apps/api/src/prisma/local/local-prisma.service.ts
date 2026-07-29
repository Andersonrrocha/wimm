/**
 * Injectable Prisma client for the local (offline, no-accounts) composition of
 * the API -- the SQLite counterpart of `PrismaService` (which drives Postgres).
 *
 * **The carry-over this closes.** `openLocalDatabase` (see that module's doc
 * comment) already sets and verifies `foreign_keys` and `journal_mode` on its
 * own connections, refusing to hand back a handle if either could not be
 * confirmed. But Prisma's *runtime* connections never go through
 * `openLocalDatabase` -- they are opened by `@prisma/adapter-better-sqlite3`,
 * which relies on the underlying driver's default. That is exactly the
 * reliance `openLocalDatabase` exists to remove, left open one layer down:
 * every `onDelete: Cascade`, `Restrict` and `SetNull` in the schema depends on
 * `foreign_keys = ON`, and this service is the only connection real requests
 * ever run through.
 *
 * Two different `better-sqlite3` builds are in play for this one process: the
 * root workspace dependency and the copy `@prisma/adapter-better-sqlite3`
 * bundles under its own `node_modules`. Both default `foreign_keys` to `1`
 * today -- which is exactly why a test that only checks the *final* pragma
 * value proves nothing: it would pass identically whether this service sets
 * anything at all. A driver upgrade in either package changing that default
 * must not be able to silently disable cascade behaviour in the shipping app,
 * so this service does not trust the default even though it currently agrees
 * with it: it sets `foreign_keys = ON` explicitly and reads the value back
 * through the very same connection Prisma will use for every query, refusing
 * to hand back a usable service if the read-back disagrees. Same contract as
 * `openLocalDatabase`: set, verify, refuse -- never warn and continue.
 *
 * Both the set and the verification go through `$queryRawUnsafe` rather than
 * any lower-level driver handle, because Prisma owns the connection here --
 * there is no `Database` instance of our own to call `.pragma()` on. Reading
 * back through `$queryRawUnsafe` is what proves the pragma actually holds for
 * the connection Prisma itself will issue every later query on, not merely
 * for some separate handle that happens to share a file path.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../../generated/prisma-sqlite/client'

interface ForeignKeysPragmaRow {
  // better-sqlite3's PRAGMA results come back as `bigint` through this
  // adapter (confirmed empirically -- `PRAGMA foreign_keys` reads back as
  // `1n`, not `1`), because PRAGMA columns carry no declared type for
  // Prisma to map from. The comparison below normalizes via `Number(...)`
  // so a future driver version representing this as a plain `number`
  // instead does not itself trip the refusal -- only the actual enforcement
  // value (0 vs 1) matters here, not which JS type carries it.
  foreign_keys: bigint | number
}

@Injectable()
export class LocalPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly file: string) {
    super({ adapter: new PrismaBetterSqlite3({ url: file }) })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()

    // Set explicitly rather than trusting the driver default -- see the
    // module doc comment for why the default agreeing today is not enough.
    await this.$queryRawUnsafe('PRAGMA foreign_keys = ON')

    // Read back through the same connection Prisma will issue every later
    // query on, and refuse to hand back a usable service if it disagrees.
    const rows = await this.$queryRawUnsafe<ForeignKeysPragmaRow[]>('PRAGMA foreign_keys')
    const fk = rows[0]?.foreign_keys

    if (Number(fk) !== 1) {
      // Mirrors openLocalDatabase's contract: close before refusing, so a
      // failed verification never leaves a connected-but-untrusted handle
      // behind for something else to accidentally use.
      await this.$disconnect()
      throw new Error(
        `LocalPrismaService: refusing to use ${this.file} -- foreign key enforcement could not be verified as ON ` +
          `(read back ${String(fk)}). Two different better-sqlite3 builds are in play here (the root workspace ` +
          "dependency and the one bundled with @prisma/adapter-better-sqlite3); a version drift in either must " +
          'not be able to silently disable ON DELETE CASCADE / SetNull / Restrict for this connection.',
      )
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
