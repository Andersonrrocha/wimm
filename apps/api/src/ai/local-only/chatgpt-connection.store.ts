import { Injectable } from '@nestjs/common'
import {
  decryptWithAiKey,
  deriveAiKeyEncryptionKey,
  encryptWithAiKey,
} from '../ai-key-crypto'
import { assertUsableAiKeyEncryptionSecret } from '../../prisma/local/profile-secret'
import { PrismaService } from '../../prisma/prisma.service'
import type { ChatGptCredentials } from './chatgpt-token-exchange'

/**
 * What the API is allowed to say about a connection. Deliberately has no
 * field a token could be placed in: `status()` builds this object from
 * scratch, so adding a secret to it is a type error, not a review comment.
 */
export interface ChatGptConnectionStatus {
  connected: boolean
  sharing: boolean
  accountLabel: string | null
  expiresAt: Date | null
}

/**
 * Encrypted persistence for one user's ChatGPT plan-usage connection, over
 * the `ChatGptConnection` table.
 *
 * Tokens (access, refresh, id) live in `tokensEncrypted` as one AES-256-GCM
 * blob under the per-profile secret, with exactly the primitives `AiKeyCrypto`
 * uses for the BYOK key (`ai-key-crypto.ts`). `scopes`, `sharing`, `expiresAt`
 * and `subject` are also written as plain columns, but they are mirrors:
 * every read in this class comes from the decrypted payload, so the store can
 * never report something the provider would not see.
 *
 * **The secret is a constructor argument, not `ConfigService`.**
 * `AiKeyCrypto` reads its secret from config, but `ai-key-crypto.ts` exports
 * the derive/encrypt/decrypt functions standalone precisely so a caller
 * outside that class can use them (its doc comment records `profile-secret.ts`'s
 * migration as the reason). This store takes the same `aiKeyEncryptionSecret`
 * string `AppLocalModule.forRoot` already receives, so nothing new has to be
 * configured. Because that parameter is a plain `string`, Nest cannot resolve
 * it by type: the module that registers this class must supply it explicitly
 * (a factory or an injection token).
 *
 * **A row that cannot be decrypted is "no connection", not an error.** A
 * profile that is exported and re-imported elsewhere carries its SQLite file
 * but not the secret that lives outside it, exactly the case
 * `AiKeyResolverService` already treats as "no key". Throwing here would turn
 * a portable-profile feature into an app that cannot categorize; returning
 * `null` makes the user reconnect instead. The same goes for a payload that
 * decrypts but is not the shape this class wrote.
 *
 * **`refreshToken` is `string | null` and stays that way.** `null` means
 * `offline_access` was not granted, so the connection cannot be refreshed and
 * needs a fresh sign-in when it expires. JSON round-trips `null` natively, so
 * nothing here may turn it into `''`: an empty string would reach a refresh
 * grant looking like a real token and fail at the authorization server
 * instead of locally.
 *
 * **Disconnect clears secrets, not identity.** `clearTokens` keeps `clientId`
 * (the durable per-installation client ID, which is the `id_token` audience:
 * re-registering would invalidate every previously stored identity) and
 * `accountLabel`.
 *
 * Local compositions only: this lives under `ai/local-only/`, which the
 * hosted root must never reach (see `scripts/verify-ai-hosted-composition.ts`).
 */
@Injectable()
export class ChatGptConnectionStore {
  private readonly key: Buffer

  constructor(
    private readonly prisma: PrismaService,
    aiKeyEncryptionSecret: string,
  ) {
    // Same refuse-don't-continue contract as `AppLocalModule.forRoot`: a key
    // derived from an empty secret is guessable by anyone holding the file.
    assertUsableAiKeyEncryptionSecret(aiKeyEncryptionSecret)
    this.key = deriveAiKeyEncryptionKey(aiKeyEncryptionSecret)
  }

  /** The live credentials, or `null` when there are none or they cannot be read. */
  async load(userId: string): Promise<ChatGptCredentials | null> {
    const row = await this.prisma.chatGptConnection.findUnique({
      where: { userId },
      select: { tokensEncrypted: true },
    })
    return this.open(row?.tokensEncrypted ?? null)
  }

  /** Rotated credentials awaiting identity verification, if any. */
  /**
   * The live credential and its generation marker, for a caller that is
   * about to write based on what it reads.
   *
   * `load` stays the simpler reader for callers that only need the token.
   * `savePending` *requires* a generation, so a caller that took the simple
   * path has nothing to pass and the compiler stops it there rather than at
   * runtime.
   */
  async loadLive(userId: string): Promise<LiveConnection | null> {
    const row = await this.prisma.chatGptConnection.findUnique({
      where: { userId },
      select: { tokensEncrypted: true },
    })
    const sealed = row?.tokensEncrypted ?? null
    const credentials = this.open(sealed)
    if (sealed === null || credentials === null) return null
    return { credentials, generation: sealed }
  }

  async loadPending(userId: string): Promise<PendingRotation | null> {
    const row = await this.prisma.chatGptConnection.findUnique({
      where: { userId },
      select: { pendingEncrypted: true },
    })
    const sealed = row?.pendingEncrypted ?? null
    const credentials = this.open(sealed)
    if (sealed === null || credentials === null) return null
    const receivedAt = this.openReceivedAt(sealed)
    // A rotation with no readable receipt time is corruption: verifying it
    // against the wrong clock is exactly the failure this field prevents.
    if (receivedAt === null) return null
    return { credentials, receivedAt }
  }

  /** The receipt time sealed alongside a pending rotation, or null. */
  private openReceivedAt(sealed: string): Date | null {
    try {
      const payload = JSON.parse(decryptWithAiKey(this.key, sealed)) as {
        receivedAt?: unknown
      }
      if (typeof payload.receivedAt !== 'string') return null
      const parsed = new Date(payload.receivedAt)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    } catch {
      return null
    }
  }

  /** The durable client ID. Survives `clearTokens`. */
  async loadClientId(userId: string): Promise<string | null> {
    const row = await this.prisma.chatGptConnection.findUnique({
      where: { userId },
      select: { clientId: true },
    })
    return row?.clientId ?? null
  }

  /**
   * Stores a freshly established connection. A new sign-in supersedes any
   * rotation that was still pending, so the pending slot is cleared.
   *
   * `clientId` is a separate argument because it outlives the credentials.
   *
   * `accountLabel` is optional, and the three cases are distinct:
   * **omitted** leaves whatever label is already there (this class retains
   * one across a disconnect, and a caller that does not know the label must
   * not erase it); **a string** writes it; **`null`** clears it. The connect
   * flow passes the label its just-verified `id_token` carried, including
   * `null` -- the status endpoint must name the account that is actually
   * connected, never one left over from a different sign-in.
   */
  async save(
    userId: string,
    clientId: string,
    credentials: ChatGptCredentials,
    accountLabel?: string | null,
  ): Promise<void> {
    const data = {
      clientId,
      tokensEncrypted: this.seal(credentials),
      pendingEncrypted: null,
      // Spread rather than passing `accountLabel` through: Prisma does read
      // an explicit `undefined` as "field not provided", so the two are
      // equivalent today -- but "leave the column alone" is the contract
      // here, and stating it in the shape of the data rather than relying on
      // that convention is what keeps it true if this object is ever reused
      // for a raw write.
      ...(accountLabel === undefined ? {} : { accountLabel }),
      ...mirror(credentials),
    }
    await this.prisma.chatGptConnection.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    })
  }

  /**
   * Persists rotated credentials *beside* the live ones, before their
   * identity is verified, so a restart resumes verification instead of
   * replaying an already-consumed refresh token. The live credential is not
   * touched. Requires an existing connection: without one there is no
   * `clientId` to create the row with.
   */
  async savePending(
    userId: string,
    credentials: ChatGptCredentials,
    receivedAt: Date,
    expectedGeneration: string,
  ): Promise<void> {
    // Conditional on a LIVE connection. `clearTokens` deliberately keeps the
    // row so `clientId` survives a disconnect, so a plain
    // `update({ where: { userId } })` still finds it -- and a refresh that
    // was already in flight when the user clicked Disconnect would put a
    // refresh token back on disk, which a later `promotePending` would make
    // live again with `sharing` true. Reconnecting itself after an explicit
    // disconnect is not a race worth tolerating.
    // Conditional on the SAME live credential the caller read, not merely on
    // some live credential existing. `tokensEncrypted: { not: null }` alone
    // closes the disconnect case but not disconnect-then-reconnect: a flight
    // that started before a fresh sign-in would still write its stale
    // rotation, and the following promote would make it live over the new
    // one. Reproduced against this store in review.
    const { count } = await this.prisma.chatGptConnection.updateMany({
      where: { userId, tokensEncrypted: expectedGeneration },
      data: { pendingEncrypted: this.seal(credentials, receivedAt) },
    })
    if (count === 0) {
      throw new Error('No live ChatGPT connection to rotate.')
    }
  }

  /**
   * Makes the pending rotation the live credential and empties the pending
   * slot. A no-op when nothing is pending (so a retry after a crash between
   * verification and promotion is safe) or when the pending value cannot be
   * read.
   */
  /**
   * Promotes a saved rotation, returning whether it actually landed.
   *
   * The boolean matters: a lost compare-and-swap leaves the OLD credentials
   * live, and a caller that assumed success would then refresh using an
   * already-consumed refresh token. A server that detects reuse may revoke
   * the whole grant, so "it didn't land" must be visible.
   */
  async promotePending(userId: string): Promise<boolean> {
    const row = await this.prisma.chatGptConnection.findUnique({
      where: { userId },
      select: { pendingEncrypted: true },
    })
    const sealed = row?.pendingEncrypted ?? null
    const credentials = this.open(sealed)
    if (sealed === null || credentials === null) return false

    // Conditional on the pending value still being the one just read, so a
    // newer `savePending` that landed in between is not discarded.
    const { count } = await this.prisma.chatGptConnection.updateMany({
      where: { userId, pendingEncrypted: sealed },
      data: {
        tokensEncrypted: sealed,
        pendingEncrypted: null,
        ...mirror(credentials),
      },
    })
    return count > 0
  }

  /**
   * Disconnects: drops every secret, keeps `clientId` and `accountLabel`.
   * `sharing` and `expiresAt` describe a live connection, so they are reset
   * rather than left claiming one.
   */
  /**
   * Clears every secret, keeping `clientId` and `accountLabel`.
   *
   * `expectedGeneration` makes the clear conditional on the live credential
   * still being the one the caller read. A refresh that fails terminally
   * must pass it: without it, a flight that started before a reconnect wipes
   * the fresh sign-in. A user-initiated disconnect passes nothing — it means
   * "clear whatever is there".
   */
  async clearTokens(userId: string, expectedGeneration?: string): Promise<void> {
    await this.prisma.chatGptConnection.updateMany({
      where: {
        userId,
        ...(expectedGeneration === undefined
          ? {}
          : { tokensEncrypted: expectedGeneration }),
      },
      data: {
        tokensEncrypted: null,
        pendingEncrypted: null,
        sharing: false,
        expiresAt: null,
        // `subject` is the one account identifier among the mirror columns,
        // nothing ever reads it, and a disconnect should not leave it behind.
        // `clientId` and `accountLabel` are retained deliberately -- see this
        // method's contract.
        subject: null,
      },
    })
  }

  /**
   * The only view of a connection that may leave this class. `connected` is
   * whether credentials can actually be *read*, not merely whether a blob
   * exists: a row left undecryptable by an exported profile would otherwise
   * show as connected while every call quietly returned nothing.
   */
  async status(userId: string): Promise<ChatGptConnectionStatus> {
    const row = await this.prisma.chatGptConnection.findUnique({
      where: { userId },
      select: { tokensEncrypted: true, accountLabel: true },
    })
    const credentials = this.open(row?.tokensEncrypted ?? null)
    return {
      connected: credentials !== null,
      sharing: credentials?.sharing ?? false,
      accountLabel: row?.accountLabel ?? null,
      expiresAt: credentials?.expiresAt ?? null,
    }
  }

  private seal(credentials: ChatGptCredentials, receivedAt?: Date): string {
    const payload: StoredPayload = {
      ...(receivedAt === undefined
        ? {}
        : { receivedAt: receivedAt.toISOString() }),
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      idToken: credentials.idToken,
      expiresAt: credentials.expiresAt.toISOString(),
      scopes: credentials.scopes,
      subject: credentials.subject,
      sharing: credentials.sharing,
    }
    return encryptWithAiKey(this.key, JSON.stringify(payload))
  }

  /** `null` for an empty slot, an undecryptable blob, or a payload of the wrong shape. */
  private open(sealed: string | null): ChatGptCredentials | null {
    if (sealed === null) return null
    try {
      return toCredentials(JSON.parse(decryptWithAiKey(this.key, sealed)))
    } catch {
      // Deliberately silent and deliberately unlogged: the only thing known
      // here is that a secret-bearing value failed, and nothing about it is
      // safe to repeat.
      return null
    }
  }
}

/** What is encrypted. `expiresAt` is an ISO string because JSON has no Date. */
/**
 * A saved rotation, with the moment it was received.
 *
 * The receipt time is load-bearing, not bookkeeping: a signing-key outage can
 * outlast the identity token without invalidating the refresh token, so a
 * resumed rotation must be verified as of when it arrived. Verified against
 * the current clock it would fail permanently, on a refresh token that has
 * already been consumed -- an account that can never reconnect.
 */
/**
 * The live credential together with an opaque marker for *this* stored
 * value.
 *
 * Pass `generation` back to `savePending` or `clearTokens` so a write that
 * started from this credential cannot land on a different one. Without it, a
 * refresh still in flight across a disconnect **and a reconnect** writes its
 * stale rotation over the fresh sign-in, or wipes it on a terminal error --
 * both reproduced against this store in review.
 *
 * It is the stored ciphertext. Every save re-encrypts with a random IV, so
 * each one is unique and the comparison cannot suffer ABA. Callers must treat
 * it as opaque: it is a generation marker, not a credential to read.
 */
export interface LiveConnection {
  credentials: ChatGptCredentials
  generation: string
}

export interface PendingRotation {
  credentials: ChatGptCredentials
  receivedAt: Date
}

interface StoredPayload {
  accessToken: string
  refreshToken: string | null
  idToken: string
  expiresAt: string
  scopes: string
  subject: string
  sharing: boolean
  /** Only written for a pending rotation; absent on the live credentials. */
  receivedAt?: string
}

/** The non-secret columns that mirror the payload. */
function mirror(credentials: ChatGptCredentials) {
  return {
    scopes: credentials.scopes,
    sharing: credentials.sharing,
    expiresAt: credentials.expiresAt,
    subject: credentials.subject,
  }
}

/**
 * Rebuilds credentials from a parsed payload, throwing on any field of the
 * wrong type. `refreshToken` must be a string or an explicit `null`; a
 * missing key is corruption, not "no refresh token", so it is rejected
 * rather than defaulted.
 */
function toCredentials(value: unknown): ChatGptCredentials {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored ChatGPT credentials are malformed.')
  }
  const p = value as Record<string, unknown>
  const expiresAt = typeof p.expiresAt === 'string' ? new Date(p.expiresAt) : null
  if (
    typeof p.accessToken !== 'string' ||
    !(typeof p.refreshToken === 'string' || p.refreshToken === null) ||
    typeof p.idToken !== 'string' ||
    expiresAt === null ||
    Number.isNaN(expiresAt.getTime()) ||
    typeof p.scopes !== 'string' ||
    typeof p.subject !== 'string' ||
    typeof p.sharing !== 'boolean'
  ) {
    throw new Error('Stored ChatGPT credentials are malformed.')
  }
  return {
    accessToken: p.accessToken,
    refreshToken: p.refreshToken,
    idToken: p.idToken,
    expiresAt,
    scopes: p.scopes,
    subject: p.subject,
    sharing: p.sharing,
  }
}
