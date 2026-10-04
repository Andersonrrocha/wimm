# ChatGPT Plan Usage Provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a WIMM user connects their own ChatGPT account and import categorization draws on their own Plus/Pro allowance — no API key pasted, no per-token cost, and no secret of theirs reaching the renderer, a log, or an exported profile.

**Architecture:** the OAuth protocol lives entirely in `apps/api/src/ai/local-only/` as plain Node (the embedded Nest API runs *in* the Electron main process, so a `node:http` loopback listener is available without Electron). `apps/desktop` contributes exactly one injected callback, `openBrowser(url)`, backed by `shell.openExternal`. Tokens are encrypted with the existing per-profile secret and stored in the profile database. The provider owns its own credential and refresh, so an access token can be rotated mid-batch.

**Tech Stack:** NestJS, Prisma (two migration chains: Postgres + derived SQLite baseline), `@nestjs/jwt` (already a dependency), Node 22 globals (`fetch`, `crypto.createPublicKey({ format: 'jwk' })`), Jest. **No new top-level dependency.**

**Source of truth:** `docs/superpowers/specs/2026-10-02-chatgpt-plan-usage-oauth-design.md`. Read its "Protocol facts" section before Task 3; the values there are exact and must not be paraphrased.

## Global Constraints

- All code, comments and commits in English. User-facing strings in `en` and `pt` only, via `i18next`.
- `apps/mobile` must not be touched by this plan.
- `apps/api` must stay Electron-free. No `import ... from 'electron'` anywhere under `apps/api`.
- The access token, refresh token and `id_token` must never reach the renderer, a log, an error message, or a crash report.
- No embedded `BrowserWindow` for the authorization page — system browser only.
- Never relax `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, the CSP, the navigation denials, or the IPC bridge's main-side validation.
- The plan-usage provider must stay unreachable from `app.module.ts`. `pnpm --filter @wimm/api verify:ai-hosted-composition` must exit 0 after every task.
- Run tests with `pnpm test`, never bare `npx jest`, in `apps/api` — the package's `test` script sets `NODE_OPTIONS=--experimental-vm-modules` (pdfjs needs it) and `pretest` selects the node native ABI. Bare `npx jest` produces 6 spurious failing suites.
- Issuer `https://auth.openai.com`; resource `https://api.openai.com/v1`; scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`; callback path `/auth/callback` on `127.0.0.1`; `code_challenge_method=S256`.
- Every request to `https://api.openai.com/v1/responses` must carry `store: false`.
- `assert:parity` is offline and must pass after every schema change. `assert:constraints` is **not** offline — it reads `DATABASE_URL` and queries live Postgres — so never put it in an offline verification chain, and never apply a migration to a live database to make it pass.
- Derived Prisma artifacts (`prisma/schema.sqlite.prisma`, `prisma/migrations-sqlite/0000_baseline/migration.sql`) are regenerated with `gen:sqlite-schema` / `gen:sqlite-baseline`, never hand-edited: parity compares them byte for byte.
- New model ids use `@default(uuid())`, matching the 11 existing models.
- **Stage by explicit file path, never `git add -A` or a directory.** More than one agent may be working in this worktree, and a directory-wide stage has already come close to sweeping another task's in-flight edits into the wrong commit. Each task's commit step names its own files.
- Do not add attribution lines to commit messages.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/prisma/schema.prisma` | `ChatGptConnection` model (modify) |
| `apps/api/prisma/migrations/20261002120000_add_chatgpt_connection/migration.sql` | Postgres chain |
| `apps/api/prisma/schema.sqlite.prisma` | regenerated derived schema (`gen:sqlite-schema`) |
| `apps/api/prisma/migrations-sqlite/0000_baseline/migration.sql` | regenerated SQLite baseline (`gen:sqlite-baseline`) |
| `apps/api/src/ai/ai-provider.interface.ts` | drop `apiKey` from the contract (modify) |
| `apps/api/src/ai/anthropic-categorizer.service.ts` | resolve its own key (modify) |
| `apps/api/src/imports/imports.service.ts` | stop passing `apiKey` (modify) |
| `apps/api/src/ai/local-only/chatgpt-oidc.ts` | OIDC discovery + protocol constants |
| `apps/api/src/ai/local-only/chatgpt-authorize.ts` | PKCE/state/nonce + authorize URL |
| `apps/api/src/ai/local-only/chatgpt-callback-listener.ts` | loopback listener + callback validation |
| `apps/api/src/ai/local-only/chatgpt-token-exchange.ts` | code exchange + `id_token` verification |
| `apps/api/src/ai/local-only/chatgpt-connection.store.ts` | encrypted persistence + pending rotation |
| `apps/api/src/ai/local-only/chatgpt-refresh.service.ts` | single-flight refresh |
| `apps/api/src/ai/local-only/chatgpt-oauth-provider.ts` | `AiProvider` impl (replaces the stub) |
| `apps/api/src/ai/local-only/chatgpt-connect-flow.ts` | composes discovery → listener → browser → exchange → store |
| `apps/api/src/ai/local-only/chatgpt.controller.ts` | connect / status / disconnect |
| `apps/api/src/ai/local-only/local-only-ai.module.ts` | wire the above (modify) |
| `apps/desktop/src/main/chatgpt-browser.ts` | `openBrowser` via `shell.openExternal` |
| `apps/desktop/src/renderer/.../ChatGptConnection.tsx` | connect UI + failure messages |

---

## Task 1: `ChatGptConnection` schema and both migration chains

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261002120000_add_chatgpt_connection/migration.sql`
- Modify: `apps/api/prisma/schema.sqlite.prisma` (derived; regenerate, never hand-edit)
- Modify: `apps/api/prisma/migrations-sqlite/0000_baseline/migration.sql` (derived; regenerate, never hand-edit)

**Interfaces:**
- Produces: a `chatGptConnection` Prisma delegate with fields `userId` (unique), `clientId`, `tokensEncrypted`, `pendingEncrypted`, `scopes`, `sharing`, `expiresAt`, `subject`, `accountLabel`, `createdAt`, `updatedAt`.

**Why a table and not columns on `User`:** the connection has its own lifecycle (connect, rotate, disconnect) and a disconnect must clear tokens while retaining `clientId` and `accountLabel`. Modelling that as eight nullable `User` columns makes "connected" an implicit conjunction no constraint can express.

- [ ] **Step 1: Confirm the migration timestamp sorts last**

```bash
ls apps/api/prisma/migrations | sort | tail -3
```

Expected: the highest existing directory is `20260803120000_add_csv_source_mapping`, so `20261002120000_...` sorts after it. If anything higher than `20261002120000` exists, pick a later timestamp — the design doc records that this repository already contains one migration that can never run because of a bad sort order, and a second would be unforced.

- [ ] **Step 2: Add the model to `schema.prisma`**

Append to the model list, and add the back-relation `chatGptConnection ChatGptConnection?` to `User`:

```prisma
/// One ChatGPT plan-usage connection per user. Local compositions only;
/// the hosted chain gets the table but never populates it (see
/// verify-ai-hosted-composition.ts for why that boundary exists).
model ChatGptConnection {
  id               String   @id @default(uuid())
  userId           String   @unique
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// Durable per-installation client ID issued by dynamic registration.
  /// Retained across disconnect: it is the `id_token` audience, and
  /// re-registering would invalidate every previously stored identity.
  clientId         String
  /// AES-256-GCM, base64. Access + refresh token and id_token. NULL after
  /// disconnect. Never returned by the API.
  tokensEncrypted  String?
  /// Rotated credentials persisted before their identity is verified, so a
  /// signing-key outage or restart resumes verification instead of reusing
  /// an already-consumed refresh token.
  pendingEncrypted String?
  /// Space-separated granted scopes. Refresh responses may omit `scope`;
  /// this is the fallback, not a downgrade signal.
  scopes           String
  /// Whether the account's plan actually grants plan usage.
  sharing          Boolean  @default(false)
  expiresAt        DateTime?
  subject          String?
  accountLabel     String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

- [ ] **Step 3: Write the Postgres migration**

```sql
-- apps/api/prisma/migrations/20261002120000_add_chatgpt_connection/migration.sql
CREATE TABLE "ChatGptConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tokensEncrypted" TEXT,
    "pendingEncrypted" TEXT,
    "scopes" TEXT NOT NULL,
    "sharing" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "subject" TEXT,
    "accountLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatGptConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatGptConnection_userId_key" ON "ChatGptConnection"("userId");

ALTER TABLE "ChatGptConnection" ADD CONSTRAINT "ChatGptConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Regenerate the two derived SQLite artifacts, then assert parity**

Both are generated, never hand-written — parity check 1 and check 3 compare them **byte for byte** against what deriving them produces, so a hand edit fails even when it is semantically correct:

```bash
pnpm --filter @wimm/api gen:sqlite-schema
pnpm --filter @wimm/api gen:sqlite-baseline
pnpm --filter @wimm/api assert:parity
```

Expected: `assert:parity` prints 3 PASS lines. If it complains about anything other than this task's table, **stop and report** — pre-existing drift is not this task's to fix.

**Do not run `assert:constraints` here.** Unlike `assert:parity`, it is not offline: it loads `dotenv/config`, reads `DATABASE_URL`, and runs a `SELECT ... FROM pg_constraint` against a live Postgres. It cannot pass without a migrated Postgres, and this task must not apply migrations to one. The SQLite side of the same guarantee is parity check 2 ("Baseline carries every CHECK constraint"), which `assert:parity` already covers.

- [ ] **Step 5: Run the full api suite and the composition guard**

```bash
pnpm --filter @wimm/api test && pnpm --filter @wimm/api verify:ai-hosted-composition
```

Expected: suite green (baseline: 67 suites / 596 tests), guard exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(database): add ChatGptConnection across both migration chains"
```

---

## Task 2: Drop `apiKey` from the `AiProvider` contract

**Files:**
- Modify: `apps/api/src/ai/ai-provider.interface.ts`
- Modify: `apps/api/src/ai/anthropic-categorizer.service.ts`
- Modify: `apps/api/src/imports/imports.service.ts` (around line 646)
- Modify: `apps/api/src/ai/local-only/chatgpt-oauth-provider.stub.ts`
- Test: existing specs for the above change with them

**Interfaces:**
- Produces: `categorizeBatch(args: { userId: string; transactions: AiCategorizeInput[]; candidates: AiCategorizeCandidate[] }): Promise<AiCategorizeResult[]>`

**Why, stated honestly:** the interface's own doc comment anticipated carrying an OAuth access token in `apiKey`, so this change is not forced by typing. It is forced by *timing*: a credential resolved before the call can expire mid-batch, and a provider that does not own its credential cannot rotate in flight. `userId` replaces `apiKey` because every provider needs to know *whose* credential to resolve.

**This task cannot meet the "existing specs pass untouched" bar** that Stages 2 and 3 used as proof of a refactor. The spec churn is expected here and is not scope creep.

- [ ] **Step 1: Run the affected specs first, to record the starting state**

```bash
pnpm --filter @wimm/api test -- anthropic-categorizer ai-provider imports.service
```

Record the pass counts; they are the comparison point for Step 5.

- [ ] **Step 2: Change the interface**

In `ai-provider.interface.ts`, replace the `categorizeBatch` signature and update the doc comment paragraph that explains `apiKey`:

```ts
export interface AiProvider {
  readonly id: string

  categorizeBatch(args: {
    userId: string
    transactions: AiCategorizeInput[]
    candidates: AiCategorizeCandidate[]
  }): Promise<AiCategorizeResult[]>
}
```

Replace the `apiKey`-is-generic paragraph with: a provider resolves its own credential, because credential lifetime is provider-specific — an OAuth access token can expire mid-batch and must be refreshable in flight, which a caller-supplied string cannot express.

- [ ] **Step 3: Make the Anthropic provider resolve its own key**

Inject `AiKeyResolverService` and resolve inside `categorizeBatch`:

```ts
constructor(private readonly keys: AiKeyResolverService) {}

async categorizeBatch(args: {
  userId: string
  transactions: AiCategorizeInput[]
  candidates: AiCategorizeCandidate[]
}): Promise<AiCategorizeResult[]> {
  const apiKey = await this.keys.resolveForUser(args.userId)
  if (!apiKey) return []
  const client = new Anthropic({ apiKey })
  // ... rest unchanged
}
```

Returning `[]` rather than throwing matches how `AiKeyResolverService` already treats a decrypt failure as "no key" instead of crashing.

- [ ] **Step 4: Update the call site**

In `imports.service.ts`, delete the now-dead key resolution ahead of the call (the `if (!apiKey) return` guard and whatever resolves `apiKey`) and pass `userId`:

```ts
const results = await this.aiCategorizer.categorizeBatch({
  userId,
  transactions: inputs,
  candidates,
})
```

Keep the surrounding `try/catch` and its `logger.warn` exactly as they are. Verify the warning interpolates only `userId` and `message` — never a credential.

- [ ] **Step 5: Update the stub's signature, then run the suite**

Change `chatgpt-oauth-provider.stub.ts`'s `categorizeBatch(_args: ...)` to the new shape; it still throws unconditionally.

```bash
pnpm --filter @wimm/api test
```

Expected: green. Suites touching the old signature will have needed edits; those edits are this task's deliverable, not a surprise.

- [ ] **Step 6: Prove the contract actually changed (mutation check)**

```bash
grep -rn "apiKey" apps/api/src/ai/ai-provider.interface.ts apps/api/src/imports/imports.service.ts
```

Expected: no match in the interface, and no match on the `categorizeBatch` call path in `imports.service.ts`. A match means the old parameter survived somewhere and the change is incomplete.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src
git commit -m "refactor(ai): let each provider resolve its own credential"
```

---

## Task 3: OIDC discovery and protocol constants

**Files:**
- Create: `apps/api/src/ai/local-only/chatgpt-oidc.ts`
- Test: `apps/api/src/ai/local-only/chatgpt-oidc.spec.ts`

**Interfaces:**
- Produces: `CHATGPT_ISSUER`, `CHATGPT_RESOURCE`, `CHATGPT_SCOPES`, `CHATGPT_CALLBACK_PATH`, `DYNAMIC_CLIENT_ID`, and `discoverOidcConfig(fetchImpl?): Promise<OidcConfig>` where `OidcConfig = { issuer, authorization_endpoint, token_endpoint, jwks_uri, revocation_endpoint }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/ai/local-only/chatgpt-oidc.spec.ts
import { CHATGPT_ISSUER, discoverOidcConfig } from './chatgpt-oidc'

const wellFormed = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/authorize',
  token_endpoint: 'https://auth.openai.com/oauth/token',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
}

const fetchReturning = (body: unknown, ok = true) =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch

describe('discoverOidcConfig', () => {
  it('returns the discovered endpoints', async () => {
    const config = await discoverOidcConfig(fetchReturning(wellFormed))
    expect(config.token_endpoint).toBe(wellFormed.token_endpoint)
    expect(config.jwks_uri).toBe(wellFormed.jwks_uri)
  })

  it('rejects a document whose own issuer is not the expected one', async () => {
    const impostor = { ...wellFormed, issuer: 'https://auth.evil.example' }
    await expect(discoverOidcConfig(fetchReturning(impostor))).rejects.toThrow(
      /issuer/i,
    )
  })

  it('rejects a document missing any required endpoint', async () => {
    const { jwks_uri: _omitted, ...incomplete } = wellFormed
    await expect(discoverOidcConfig(fetchReturning(incomplete))).rejects.toThrow(
      /jwks_uri/,
    )
  })

  it('rejects a non-OK response', async () => {
    await expect(
      discoverOidcConfig(fetchReturning(wellFormed, false)),
    ).rejects.toThrow()
  })

  it('pins the issuer constant', () => {
    expect(CHATGPT_ISSUER).toBe('https://auth.openai.com')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @wimm/api test -- chatgpt-oidc
```

Expected: FAIL, cannot resolve `./chatgpt-oidc`.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/ai/local-only/chatgpt-oidc.ts
/**
 * Protocol constants and OIDC discovery for ChatGPT plan usage.
 *
 * Only the issuer is fixed; every endpoint is discovered, and the discovery
 * document is rejected unless its own `issuer` matches. That check is what
 * stops a redirected or substituted discovery response from pointing the
 * token exchange at an attacker-controlled endpoint.
 */
export const CHATGPT_ISSUER = 'https://auth.openai.com'
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1'
export const CHATGPT_SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
export const CHATGPT_CALLBACK_PATH = '/auth/callback'
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client'

const REQUIRED_ENDPOINTS = [
  'authorization_endpoint',
  'token_endpoint',
  'jwks_uri',
  'revocation_endpoint',
] as const

export interface OidcConfig {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  revocation_endpoint: string
}

export async function discoverOidcConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<OidcConfig> {
  const response = await fetchImpl(
    `${CHATGPT_ISSUER}/.well-known/openid-configuration`,
  )
  if (!response.ok) {
    throw new Error(
      `ChatGPT OIDC discovery failed with status ${response.status}.`,
    )
  }
  const data: unknown = await response.json()
  if (typeof data !== 'object' || data === null) {
    throw new Error('ChatGPT OIDC discovery returned a non-object document.')
  }
  const document = data as Record<string, unknown>
  if (document.issuer !== CHATGPT_ISSUER) {
    throw new Error(
      `ChatGPT OIDC discovery issuer mismatch: expected ${CHATGPT_ISSUER}.`,
    )
  }
  for (const key of REQUIRED_ENDPOINTS) {
    const value = document[key]
    if (typeof value !== 'string' || !value) {
      throw new Error(`ChatGPT OIDC discovery is missing ${key}.`)
    }
    // Presence is not enough: the PKCE verifier and the authorization code
    // are sent to `token_endpoint`. Parse and require https.
    //
    // Deliberately NOT same-origin: the real discovery document has not been
    // read, and an authorization server may legitimately serve `jwks_uri`
    // from another origin. Asserting same-origin on an unverified
    // assumption would break the live flow.
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new Error(`ChatGPT OIDC discovery has a malformed ${key}.`)
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(`ChatGPT OIDC discovery ${key} must use https.`)
    }
  }
  return document as unknown as OidcConfig
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @wimm/api test -- chatgpt-oidc
```

Expected: 11 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai/local-only/chatgpt-oidc.ts apps/api/src/ai/local-only/chatgpt-oidc.spec.ts
git commit -m "feat(ai): add ChatGPT OIDC discovery with issuer pinning"
```

---

## Task 4: PKCE, state, nonce and the authorize URL

**Files:**
- Create: `apps/api/src/ai/local-only/chatgpt-authorize.ts`
- Test: `apps/api/src/ai/local-only/chatgpt-authorize.spec.ts`

**Interfaces:**
- Consumes: `OidcConfig`, `CHATGPT_SCOPES`, `CHATGPT_RESOURCE`, `DYNAMIC_CLIENT_ID` (Task 3)
- Produces: `createAuthorizeRequest(args: { config: OidcConfig; redirectUri: string; appName: string; existingClientId?: string }): { url: string; verifier: string; state: string; nonce: string }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/ai/local-only/chatgpt-authorize.spec.ts
import { createHash } from 'crypto'
import { createAuthorizeRequest } from './chatgpt-authorize'
import { CHATGPT_RESOURCE, CHATGPT_SCOPES, DYNAMIC_CLIENT_ID } from './chatgpt-oidc'

const config = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/authorize',
  token_endpoint: 'https://auth.openai.com/oauth/token',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
}
const base = { config, redirectUri: 'http://127.0.0.1:51234/auth/callback', appName: 'WIMM' }

describe('createAuthorizeRequest', () => {
  it('derives code_challenge as base64url(sha256(verifier))', () => {
    const request = createAuthorizeRequest(base)
    const params = new URL(request.url).searchParams
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('code_challenge')).toBe(
      createHash('sha256').update(request.verifier).digest('base64url'),
    )
  })

  it('sends the dynamic client id and an agent_name_hint on first registration', () => {
    const params = new URL(createAuthorizeRequest(base).url).searchParams
    expect(params.get('client_id')).toBe(DYNAMIC_CLIENT_ID)
    expect(params.get('agent_name_hint')).toBe('WIMM')
  })

  it('reuses a stored client id and omits agent_name_hint thereafter', () => {
    const params = new URL(
      createAuthorizeRequest({ ...base, existingClientId: 'abc123' }).url,
    ).searchParams
    expect(params.get('client_id')).toBe('abc123')
    expect(params.has('agent_name_hint')).toBe(false)
  })

  it('sends the exact scopes and resource', () => {
    const params = new URL(createAuthorizeRequest(base).url).searchParams
    expect(params.get('scope')).toBe(CHATGPT_SCOPES)
    expect(params.get('resource')).toBe(CHATGPT_RESOURCE)
  })

  it('generates a distinct verifier, state and nonce on every call', () => {
    const a = createAuthorizeRequest(base)
    const b = createAuthorizeRequest(base)
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.state).not.toBe(b.state)
    expect(a.nonce).not.toBe(b.nonce)
    // RFC 7636 wants 43-128 characters from the unreserved set. A bare lower
    // bound let two real regressions through: randomBytes(100) (134 chars)
    // and .toString('base64') instead of 'base64url' (padding, '+' and '/').
    for (const value of [a.verifier, b.verifier, a.state, a.nonce]) {
      expect(value).toMatch(/^[A-Za-z0-9._~-]{43,128}$/)
    }
  })

  it('derives the three values independently of one another', () => {
    const request = createAuthorizeRequest(base)
    expect(request.state).not.toBe(request.verifier)
    expect(request.nonce).not.toBe(request.verifier)
    expect(request.state).not.toBe(request.nonce)
  })

  it('never puts the PKCE verifier anywhere in the authorize URL', () => {
    const request = createAuthorizeRequest(base)

    // The verifier is the one value that must not leave this process: it is
    // the proof redeemed at the token endpoint. Sending it as `state` or
    // `nonce` -- which the across-calls test above cannot detect, since
    // those stay distinct between calls either way -- would put it in the
    // authorize URL, the user's browser history, and every log between here
    // and OpenAI, defeating PKCE entirely. Assert on the whole URL rather
    // than on named parameters, so a future parameter cannot leak it either.
    const url = new URL(request.url)
    for (const [name, value] of url.searchParams) {
      expect({ name, leaksVerifier: value === request.verifier }).toEqual({
        name,
        leaksVerifier: false,
      })
    }
    expect(request.url).not.toContain(request.verifier)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @wimm/api test -- chatgpt-authorize
```

Expected: FAIL, cannot resolve `./chatgpt-authorize`.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/ai/local-only/chatgpt-authorize.ts
import { createHash, randomBytes } from 'crypto'
import {
  CHATGPT_RESOURCE,
  CHATGPT_SCOPES,
  DYNAMIC_CLIENT_ID,
  type OidcConfig,
} from './chatgpt-oidc'

/** 32 random bytes base64url-encoded: 43 chars, inside PKCE's 43..128 range. */
const randomValue = (): string => randomBytes(32).toString('base64url')

export interface AuthorizeRequest {
  url: string
  verifier: string
  state: string
  nonce: string
}

/**
 * Builds one authorization request. The caller must retain `verifier`,
 * `state` and `nonce` and verify the latter two later -- generating them and
 * then not checking them is the classic way to ship PKCE that proves nothing.
 *
 * `agent_name_hint` is sent only when no client ID is stored yet: dynamic
 * registration issues a durable per-installation client ID, and re-sending
 * the hint on later authorizations would request a second registration.
 */
export function createAuthorizeRequest(args: {
  config: OidcConfig
  redirectUri: string
  appName: string
  existingClientId?: string
}): AuthorizeRequest {
  const verifier = randomValue()
  const state = randomValue()
  const nonce = randomValue()
  // One trimmed read of the client id. Reading it twice -- `??` for the id
  // and `!` for the hint -- made a blank value send `client_id=` AND the
  // hint; a whitespace-only value is truthy and survives `||` too.
  const clientId = args.existingClientId?.trim() || undefined
  const url = new URL(args.config.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId ?? DYNAMIC_CLIENT_ID)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('scope', CHATGPT_SCOPES)
  url.searchParams.set('resource', CHATGPT_RESOURCE)
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set(
    'code_challenge',
    createHash('sha256').update(verifier).digest('base64url'),
  )
  if (!clientId) {
    url.searchParams.set('agent_name_hint', args.appName)
  }
  return { url: url.toString(), verifier, state, nonce }
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @wimm/api test -- chatgpt-authorize
```

Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai/local-only/chatgpt-authorize.ts apps/api/src/ai/local-only/chatgpt-authorize.spec.ts
git commit -m "feat(ai): build the ChatGPT authorize request with PKCE"
```

---

## Task 5: The loopback callback listener

**Files:**
- Create: `apps/api/src/ai/local-only/chatgpt-callback-listener.ts`
- Test: `apps/api/src/ai/local-only/chatgpt-callback-listener.spec.ts`

**Interfaces:**
- Consumes: `CHATGPT_CALLBACK_PATH`, `DYNAMIC_CLIENT_ID` (Task 3)
- Produces: `startCallbackListener(args?: { timeoutMs?: number }): Promise<CallbackListener>` where

```ts
interface CallbackListener {
  /** `http://127.0.0.1:<bound port>/auth/callback` — known only after binding. */
  redirectUri: string
  /** Arm the listener with the state to require. Call at most once. */
  awaitCallback(expectedState: string): Promise<{ code: string; clientId: string }>
  close(): void
}
```

### Why the state arrives after binding, not in the constructor

An earlier draft of this plan had `startCallbackListener({ expectedState })`, and that was **impossible to call**. Task 4's `createAuthorizeRequest` takes `redirectUri` as an input and is the only producer of `state`. A listener that takes `expectedState` as an input is the only producer of `redirectUri`, because the port does not exist until the socket is bound. Neither could go first. This was caught in review, and it would have surfaced at implementation time rather than in any test, because Task 10's controller spec overrides the flow that composes them.

Splitting binding from arming breaks the cycle and leaves Task 4 — already committed and tested — untouched. The order becomes:

```ts
const listener = await startCallbackListener({ timeoutMs })
const request = createAuthorizeRequest({
  config, redirectUri: listener.redirectUri, appName, existingClientId,
})
// Arm BEFORE opening the browser, so a fast callback cannot arrive unarmed.
const pending = listener.awaitCallback(request.state)
await openBrowser(request.url)
const { code, clientId } = await pending
```

**The listener must also tolerate the opposite order.** Buffer the first request that arrives and validate it when `awaitCallback` is called, rather than requiring the arm to come first. That removes ordering from the set of things a caller can get wrong, and it is a small state machine: hold whichever of (arm, request) arrives first, settle when both are present.

**Security surface:** this binds a real socket and receives attacker-reachable input. It must bind `127.0.0.1` only, accept exactly the callback path, require a single `code`, require `state` to match the armed value, reject a `client_id` equal to `dynamic_agent_client` or failing `^[a-zA-Z0-9_-]{1,200}$`, and close on the first request.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/ai/local-only/chatgpt-callback-listener.spec.ts
import { startCallbackListener } from './chatgpt-callback-listener'

const hit = async (redirectUri: string, query: string) => {
  const url = new URL(redirectUri)
  await fetch(`${url.origin}${url.pathname}?${query}`).catch(() => undefined)
}

describe('startCallbackListener', () => {
  it('binds loopback on the callback path and resolves a valid callback', async () => {
    const listener = await startCallbackListener()
    expect(new URL(listener.redirectUri).hostname).toBe('127.0.0.1')
    expect(new URL(listener.redirectUri).pathname).toBe('/auth/callback')

    const pending = listener.awaitCallback('s-1')
    await hit(listener.redirectUri, 'code=c-1&state=s-1&client_id=abc123')

    await expect(pending).resolves.toEqual({ code: 'c-1', clientId: 'abc123' })
  })

  // DO NOT probe `0.0.0.0` here. An earlier draft of this plan did, and the
  // test was not merely vacuous but INVERTED: on macOS (BSD semantics) a
  // connection to the unspecified address is routed to the local host, so it
  // succeeds against a server bound to 127.0.0.1 as readily as against one
  // bound to everything. The assertion therefore failed against the CORRECT
  // implementation. Measured on the development host:
  //
  //   server bound 127.0.0.1 -> probe 0.0.0.0        = CONNECTED  (!)
  //   server bound 127.0.0.1 -> probe 192.168.0.106  = ECONNREFUSED
  //   server bound 0.0.0.0   -> probe 192.168.0.106  = CONNECTED
  //
  // Only a genuinely non-loopback address separates the two binds. Skip the
  // test by name on a host that has no such interface -- and note that the
  // runtime guard below still fails the whole suite if the bind is wrong, so
  // skipping costs less than it appears to.
  const portOf = (redirectUri: string): number =>
    Number(new URL(redirectUri).port)

  const accepts = (host: string, port: number): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      const socket = createConnection({ host, port })
      socket.setTimeout(2000, () => {
        socket.destroy()
        resolve(false)
      })
      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('error', () => resolve(false))
    })

  const externalAddress = (): string | undefined =>
    Object.values(networkInterfaces())
      .flatMap((addresses) => addresses ?? [])
      .find((address) => address.family === 'IPv4' && !address.internal)
      ?.address

  it('binds only the loopback interface, not every interface', async () => {
    const external = externalAddress()
    if (!external) return // nothing to prove on a host with no such interface

    // POSITIVE CONTROL, and the reason this test is trustworthy: bind a
    // throwaway wildcard server and prove the probe can reach *something*
    // through this exact path. Without it, a probe that can reach nothing at
    // all -- a firewall, a sandbox, a wrong address -- would make the
    // assertion below pass for entirely the wrong reason.
    const wildcard = createServer((socket) => socket.destroy())
    await new Promise<void>((resolve) => wildcard.listen(0, '0.0.0.0', resolve))
    const controlPort = (wildcard.address() as { port: number }).port
    const controlReachable = await accepts(external, controlPort)
    await new Promise((resolve) => wildcard.close(resolve))
    expect(controlReachable).toBe(true)

    const listener = await startCallbackListener()
    const port = portOf(listener.redirectUri)
    // Both directions: reachable on loopback, unreachable off it. Asserting
    // only the second would also pass for a server bound to nothing.
    expect(await accepts('127.0.0.1', port)).toBe(true)
    expect(await accepts(external, port)).toBe(false)
    listener.close()
  })

  it('accepts a callback that arrives before it is armed', async () => {
    const listener = await startCallbackListener()
    // Deliberately the wrong order: the request lands first.
    await hit(listener.redirectUri, 'code=c-1&state=s-1&client_id=abc123')
    await expect(listener.awaitCallback('s-1')).resolves.toEqual({
      code: 'c-1',
      clientId: 'abc123',
    })
  })

  it('rejects a buffered callback whose state does not match the armed value', async () => {
    const listener = await startCallbackListener()
    await hit(listener.redirectUri, 'code=c-1&state=WRONG&client_id=abc123')
    await expect(listener.awaitCallback('s-1')).rejects.toThrow(/state/i)
  })

  it.each([
    ['code=c-1&state=WRONG&client_id=abc123', /state/i],
    ['code=c-1&state=s-1&client_id=dynamic_agent_client', /client_id/i],
    ['code=c-1&state=s-1&client_id=has%20space', /client_id/i],
    ['code=a&code=b&state=s-1&client_id=abc123', /code/i],
    ['state=s-1&client_id=abc123', /code/i],
    ['code=c-1&state=s-1', /client_id/i],
  ])('rejects the callback %p', async (query, expected) => {
    const listener = await startCallbackListener()
    const pending = listener.awaitCallback('s-1')
    await hit(listener.redirectUri, query)
    await expect(pending).rejects.toThrow(expected)
  })

  it('rejects a request to any other path', async () => {
    const listener = await startCallbackListener()
    const pending = listener.awaitCallback('s-1')
    const origin = new URL(listener.redirectUri).origin
    await fetch(`${origin}/not-the-callback?code=c&state=s-1&client_id=abc123`).catch(
      () => undefined,
    )
    await expect(pending).rejects.toThrow()
  })

  it('rejects on timeout', async () => {
    const listener = await startCallbackListener({ timeoutMs: 50 })
    await expect(listener.awaitCallback('s-1')).rejects.toThrow(/timed out/i)
  })

  it('refuses a second arm', async () => {
    const listener = await startCallbackListener({ timeoutMs: 50 })
    listener.awaitCallback('s-1').catch(() => undefined)
    expect(() => listener.awaitCallback('s-2')).toThrow(/once/i)
    listener.close()
  })

  it('never puts the code or the state in an error message', async () => {
    const listener = await startCallbackListener()
    const pending = listener.awaitCallback('s-1')
    await hit(listener.redirectUri, 'code=secret-code&state=WRONG&client_id=abc123')
    await pending.catch((error: Error) => {
      expect(error.message).not.toContain('secret-code')
      expect(error.message).not.toContain('s-1')
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @wimm/api test -- chatgpt-callback-listener
```

Expected: FAIL, cannot resolve the module.

- [ ] **Step 3: Implement**

Structure it as a small state machine over two slots — the armed `expectedState` and the first received request — settling when both are present:

```ts
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CHATGPT_CALLBACK_PATH, DYNAMIC_CLIENT_ID } from './chatgpt-oidc'

const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,200}$/
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export interface CallbackListener {
  redirectUri: string
  awaitCallback(expectedState: string): Promise<{ code: string; clientId: string }>
  close(): void
}
```

Requirements the tests above pin, and which the implementation must therefore satisfy:

- `listen(0, '127.0.0.1')`, and nothing reachable on `0.0.0.0`.
- Only `CHATGPT_CALLBACK_PATH` is served; anything else fails the pending promise and answers 404.
- Exactly one `code` and exactly one `client_id`; `client_id` must match `CLIENT_ID_PATTERN` and must not be `DYNAMIC_CLIENT_ID`.
- `state` must equal the armed value. When a request is buffered before arming, that comparison happens at arm time.
- The timeout starts at bind, not at arm, and fires `/timed out/`.
- `awaitCallback` throws synchronously on a second call.
- **No error message may contain the code or the state.** Report which field was wrong, never its value.
- The server closes on the first request on the callback path, and `close()` is idempotent.
- Attach a `.catch(() => undefined)` to the internal promise so an unawaited rejection never becomes an unhandled rejection.

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @wimm/api test -- chatgpt-callback-listener
```

Expected: all passing.

- [ ] **Step 5: Prove the loopback bind is real, not a string**

A hostname assertion on `redirectUri` proves nothing about the bind — which is why `apps/desktop/src/main/local-api.ts` carries `assertBoundToLoopback`. **Carry the same guard here:** after `listen` resolves, read `server.address()` and refuse to continue unless the address the OS actually bound is `127.0.0.1`. Trust the OS, not the argument passed in.

With both the guard and the test in place, mutating the bind address to `'0.0.0.0'` produces two distinct, expected results:

- **Guard in place:** every test in the suite fails, because `startCallbackListener` now throws at bind. That is the production guard firing, and it is the outcome that matters.
- **Guard neutralised** (comment out its condition, to isolate the test): exactly **one** test fails — the loopback one. That is what proves the test itself discriminates rather than passing vacuously.

Run both. Reporting only the first would leave the test unproven; reporting only the second would leave the guard unproven.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai/local-only/chatgpt-callback-listener.ts apps/api/src/ai/local-only/chatgpt-callback-listener.spec.ts
git commit -m "feat(ai): add the single-use loopback callback listener"
```


## Task 6: Token exchange and identity verification

**Files:**
- Create: `apps/api/src/ai/local-only/chatgpt-token-exchange.ts`
- Test: `apps/api/src/ai/local-only/chatgpt-token-exchange.spec.ts`

**Interfaces:**
- Consumes: `OidcConfig`, `CHATGPT_RESOURCE` (Task 3)
- Produces: `exchangeCode(args: { config; clientId; code; verifier; redirectUri; nonce; fetchImpl? }): Promise<ChatGptCredentials>`, `verifyIdentity(args: { idToken; clientId; issuer; jwksUri; nonce; fetchImpl? }): Promise<{ subject: string }>`, and `isSharingGranted(scopes: string): boolean`, where `ChatGptCredentials = { accessToken, refreshToken, idToken, expiresAt, scopes, subject, sharing }`.

**`sharing` is derived, not claimed.** An earlier draft of this plan asserted `sharing` was an `id_token` claim and invented a claim URI for it. That was wrong. `sharing` is true when the connection is live *and* the **granted scopes** include `chatgpt.tokens.use.direct`:

```ts
export const SHARING_SCOPE = 'chatgpt.tokens.use.direct'

/** Whether the granted scopes actually permit plan usage. */
export function isSharingGranted(scopes: string): boolean {
  return scopes.split(/\s+/).filter(Boolean).includes(SHARING_SCOPE)
}
```

Do not look for a `sharing` claim; there is none.

**Verification requirements:** RS256 via the discovered JWKS, `issuer` equal to the discovered issuer, `audience` equal to the installation's client ID, and the `nonce` claim equal to the one generated for that authorize call. Use `@nestjs/jwt` with a key built by `crypto.createPublicKey({ key: jwk, format: 'jwk' })` — no new dependency.

- [ ] **Step 1: Write the failing test**

Generate a real RSA keypair in the test so verification is exercised rather than mocked:

```ts
// apps/api/src/ai/local-only/chatgpt-token-exchange.spec.ts
import { generateKeyPairSync, createPublicKey } from 'crypto'
import { JwtService } from '@nestjs/jwt'
import { exchangeCode, verifyIdentity } from './chatgpt-token-exchange'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
// `createPublicKey(publicKey)` throws "Invalid key object type public,
// expected private" on Node 22 -- it derives a public key, it does not accept
// one. Export the KeyObject directly; the JWK is byte-identical (verified).
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }
const config = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/authorize',
  token_endpoint: 'https://auth.openai.com/oauth/token',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
}

const signIdToken = (claims: Record<string, unknown>) =>
  new JwtService().sign(
    { iss: config.issuer, aud: 'client-1', sub: 'user-sub', ...claims },
    { privateKey, algorithm: 'RS256', keyid: 'k1', expiresIn: '5m' },
  )

const fetchStub = (tokenBody: unknown) =>
  (async (input: string | URL) => {
    const url = String(input)
    if (url === config.jwks_uri) return { ok: true, json: async () => ({ keys: [jwk] }) }
    return { ok: true, json: async () => tokenBody }
  }) as unknown as typeof fetch

describe('exchangeCode', () => {
  const ok = (idToken: string) => ({
    access_token: 'at', refresh_token: 'rt', id_token: idToken,
    expires_in: 3600, scope: 'openid offline_access chatgpt.tokens.use.direct',
  })

  it('sends the documented grant fields', async () => {
    const sent: Array<Record<string, string>> = []
    const spyFetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === config.jwks_uri) return { ok: true, json: async () => ({ keys: [jwk] }) }
      sent.push(Object.fromEntries(new URLSearchParams(String(init?.body))))
      return { ok: true, json: async () => ok(signIdToken({ nonce: 'n-1' })) }
    }) as unknown as typeof fetch

    await exchangeCode({
      config, clientId: 'client-1', code: 'c', verifier: 'v',
      redirectUri: 'http://127.0.0.1:1/auth/callback', nonce: 'n-1', fetchImpl: spyFetch,
    })
    expect(sent[0]).toMatchObject({
      grant_type: 'authorization_code', client_id: 'client-1',
      code: 'c', code_verifier: 'v', resource: 'https://api.openai.com/v1',
    })
  })

  it('rejects an id_token whose nonce does not match', async () => {
    await expect(
      exchangeCode({
        config, clientId: 'client-1', code: 'c', verifier: 'v',
        redirectUri: 'http://127.0.0.1:1/auth/callback', nonce: 'n-1',
        fetchImpl: fetchStub(ok(signIdToken({ nonce: 'DIFFERENT' }))),
      }),
    ).rejects.toThrow(/nonce/i)
  })

  it('rejects an id_token issued for another audience', async () => {
    await expect(
      exchangeCode({
        config, clientId: 'client-1', code: 'c', verifier: 'v',
        redirectUri: 'http://127.0.0.1:1/auth/callback', nonce: 'n-1',
        fetchImpl: fetchStub(ok(signIdToken({ nonce: 'n-1', aud: 'someone-else' }))),
      }),
    ).rejects.toThrow()
  })

  it('requires a refresh token when offline_access was granted', async () => {
    const noRefresh = { ...ok(signIdToken({ nonce: 'n-1' })), refresh_token: undefined }
    await expect(
      exchangeCode({
        config, clientId: 'client-1', code: 'c', verifier: 'v',
        redirectUri: 'http://127.0.0.1:1/auth/callback', nonce: 'n-1',
        fetchImpl: fetchStub(noRefresh),
      }),
    ).rejects.toThrow(/refresh/i)
  })
})

describe('verifyIdentity', () => {
  it('returns the verified subject', async () => {
    const identity = await verifyIdentity({
      idToken: signIdToken({ nonce: 'n-1' }),
      clientId: 'client-1', issuer: config.issuer, jwksUri: config.jwks_uri,
      nonce: 'n-1', fetchImpl: fetchStub({}),
    })
    expect(identity.subject).toBe('user-sub')
  })
})

describe('sharing', () => {
  it('is derived from the granted scopes, not from the id_token', () => {
    expect(isSharingGranted('openid offline_access chatgpt.tokens.use.direct')).toBe(true)
    expect(isSharingGranted('openid profile email offline_access')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @wimm/api test -- chatgpt-token-exchange
```

Expected: FAIL, cannot resolve the module.

- [ ] **Step 3: Implement**

**Two API details verified against the installed packages, not written from memory:**

1. `@nestjs/jwt@11.0.2` types `JwtVerifyOptions.publicKey` as **`string | Buffer`**, not a `KeyObject`. So `createPublicKey({ format: 'jwk' })`'s result cannot be passed through — export it to SPKI PEM first. Writing this from memory produces a type error at best and a silently wrong key at worst.
2. `JwtService.decode<T>(token, options?: jwt.DecodeOptions)` accepts `{ complete: true }`, which is how the header's `kid` is read before a key can be chosen.

```ts
// apps/api/src/ai/local-only/chatgpt-token-exchange.ts
import { createPublicKey } from 'crypto'
import { JwtService } from '@nestjs/jwt'
import {
  CHATGPT_RESOURCE,
  CHATGPT_SCOPES,
  type OidcConfig,
} from './chatgpt-oidc'

export const SHARING_SCOPE = 'chatgpt.tokens.use.direct'

/**
 * Whether the granted scopes actually permit plan usage.
 *
 * `sharing` is **derived, not claimed.** There is no `sharing` claim in the
 * `id_token`; an earlier draft of this plan said to read one and invented a
 * claim URI for it. Do not look for it.
 */
export function isSharingGranted(scopes: string): boolean {
  return scopes.split(/\s+/).filter(Boolean).includes(SHARING_SCOPE)
}

export interface ChatGptCredentials {
  accessToken: string
  /**
   * `null` when `offline_access` was not granted, meaning this connection
   * cannot be refreshed. Deliberately not `''`: an empty string would flow
   * into a refresh grant as a real-looking value and fail at the server
   * rather than here.
   */
  refreshToken: string | null
  idToken: string
  expiresAt: Date
  scopes: string
  subject: string
  sharing: boolean
}

/**
 * SPKI PEM signing keys, by `jwks_uri` then by `kid`.
 *
 * PEM rather than `KeyObject` because `JwtVerifyOptions.publicKey` is typed
 * `string | Buffer` (verified against @nestjs/jwt 11.0.2).
 */
const keyCache = new Map<string, Map<string, string>>()

async function fetchSigningKey(
  jwksUri: string,
  kid: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const cached = keyCache.get(jwksUri)?.get(kid)
  if (cached !== undefined) return cached

  const response = await fetchImpl(jwksUri)
  if (!response.ok) {
    throw new Error(
      `ChatGPT signing keys are unavailable (status ${response.status}).`,
    )
  }
  const body: unknown = await response.json()
  const keys =
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { keys?: unknown }).keys)
      ? ((body as { keys: unknown[] }).keys as Array<Record<string, unknown>>)
      : []
  const jwk = keys.find((candidate) => candidate.kid === kid)
  if (jwk === undefined) {
    throw new Error('ChatGPT signing key for this token was not found.')
  }

  const pem = createPublicKey({ key: jwk as never, format: 'jwk' })
    .export({ type: 'spki', format: 'pem' })
    .toString()

  const perUri = keyCache.get(jwksUri) ?? new Map<string, string>()
  perUri.set(kid, pem)
  keyCache.set(jwksUri, perUri)
  return pem
}

/**
 * Forget one key so a rotation is re-fetched on the next attempt.
 *
 * Without this, a key rotated mid-session would fail every verification
 * until the process restarted, which for a desktop app means until the user
 * quits WIMM.
 */
function forgetSigningKey(jwksUri: string, kid: string): void {
  keyCache.get(jwksUri)?.delete(kid)
}

export async function verifyIdentity(args: {
  idToken: string
  clientId: string
  issuer: string
  jwksUri: string
  nonce: string
  fetchImpl?: typeof fetch
}): Promise<{ subject: string }> {
  const jwt = new JwtService()
  const decoded = jwt.decode<{ header?: { kid?: unknown } } | null>(
    args.idToken,
    { complete: true },
  )
  const kid = decoded?.header?.kid
  if (typeof kid !== 'string' || !kid) {
    throw new Error('ChatGPT identity token has no usable key id.')
  }

  const publicKey = await fetchSigningKey(
    args.jwksUri,
    kid,
    args.fetchImpl ?? fetch,
  )

  let payload: { sub?: unknown; nonce?: unknown }
  try {
    payload = await jwt.verifyAsync(args.idToken, {
      publicKey,
      algorithms: ['RS256'],
      issuer: args.issuer,
      audience: args.clientId,
    })
  } catch (error) {
    // A rotated key looks exactly like a bad signature from here, so drop
    // the cached one and let the next attempt re-fetch.
    forgetSigningKey(args.jwksUri, kid)
    throw new Error(
      `ChatGPT identity could not be verified: ${(error as Error).message}`,
    )
  }

  // Generated in Task 4 and checked here. Generating a nonce and not
  // comparing it is the same class of mistake as unchecked PKCE.
  if (payload.nonce !== args.nonce) {
    throw new Error('ChatGPT identity nonce did not match the request.')
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('ChatGPT identity token has no subject.')
  }
  return { subject: payload.sub }
}

export async function exchangeCode(args: {
  config: OidcConfig
  clientId: string
  code: string
  verifier: string
  redirectUri: string
  nonce: string
  fetchImpl?: typeof fetch
}): Promise<ChatGptCredentials> {
  const fetchImpl = args.fetchImpl ?? fetch
  const response = await fetchImpl(args.config.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: args.clientId,
      code: args.code,
      code_verifier: args.verifier,
      redirect_uri: args.redirectUri,
      resource: CHATGPT_RESOURCE,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(
      `ChatGPT token exchange failed (status ${response.status}).`,
    )
  }
  const data = (await response.json()) as Record<string, unknown>

  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('ChatGPT token exchange returned no access token.')
  }
  if (typeof data.id_token !== 'string' || !data.id_token) {
    throw new Error('ChatGPT token exchange returned no identity token.')
  }
  // RFC 6749 section 5.1 makes `scope` OPTIONAL in a token response when it
  // is identical to what was requested. Reading an omission as "no scopes"
  // is exactly backwards and breaks the HAPPY path twice: `sharing` would be
  // false on a good connection, and the `offline_access` requirement below
  // would be skipped so a missing refresh token would pass unnoticed. Task 8
  // applies the same fallback on refresh; keep the two consistent.
  const scopes =
    typeof data.scope === 'string' && data.scope ? data.scope : CHATGPT_SCOPES
  const needsRefresh = scopes.split(/\s+/).includes('offline_access')
  if (
    needsRefresh &&
    (typeof data.refresh_token !== 'string' || !data.refresh_token)
  ) {
    throw new Error(
      'ChatGPT token exchange granted offline_access but returned no refresh token.',
    )
  }
  const expiresInSeconds =
    typeof data.expires_in === 'number' && Number.isFinite(data.expires_in)
      ? data.expires_in
      : 0

  const identity = await verifyIdentity({
    idToken: data.id_token,
    clientId: args.clientId,
    issuer: args.config.issuer,
    jwksUri: args.config.jwks_uri,
    nonce: args.nonce,
    fetchImpl,
  })

  return {
    accessToken: data.access_token,
    refreshToken:
      typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : null,
    idToken: data.id_token,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    scopes,
    subject: identity.subject,
    sharing: isSharingGranted(scopes),
  }
}
```

### Hardening added after review — the committed file is the reference

The code above is what the task started from. Review found seven properties it did not have, and **`apps/api/src/ai/local-only/chatgpt-token-exchange.ts` as committed is now the reference implementation** — do not copy the snippet above without these:

1. **`verifyIdentity` failed OPEN on a falsy `clientId`, `issuer` or `nonce`.** `jsonwebtoken` guards its own checks with truthiness (`if (options.audience)`, `if (options.issuer)`), so an empty string *skips* the check rather than tightening it; and `nonce: undefined` against an absent claim is `undefined !== undefined`, which is false. A guard at the top of the function now refuses all three. This function is exported and Task 8 calls it directly, which is why the guard belongs there and not in the caller.
2. **`exp` is now required.** OIDC Core makes it REQUIRED, but `jsonwebtoken` enforces it only when the claim is present — so a validly signed token with no `exp` was accepted and never expired.
3. **`algorithms: ['RS256']` and expiry enforcement had no tests.** Removing the algorithm pin, or adding `ignoreExpiration: true`, passed the whole suite. Both are now pinned, including an HS256-token-signed-with-the-public-PEM case: the classic algorithm-confusion attack, where a public key becomes an HMAC secret anyone can use.
4. **`redirect: 'error'` on the token POST.** `fetch` follows a 307/308 and **re-sends the body**, which here is the authorization code and the PKCE verifier. The endpoint is pinned by discovery and https-checked, but a redirect would still forward both.
5. **`expires_in` is clamped to a year.** `1e13` produced an `Invalid Date` that still satisfied `Number.isFinite`, and because every `expiresAt <= now` comparison is false for `NaN`, the credential read as never expiring.
6. **Every parse path is wrapped.** `jwt.decode`, both `response.json()` calls and `createPublicKey` all threw raw library errors, and two of those quote the first characters of what they failed to parse — a fragment of the identity token or of the token response. A JSON `null` body and a `null` entry in `keys` are rejected explicitly rather than throwing a `TypeError`.
7. **`redirect_uri` is asserted in the grant-fields test.** Dropping it from the body passed every test, and a conformant server rejects an exchange without it.

**Knowingly left alone:** the signing-key cache has no TTL, so a key withdrawn from the JWKS stays trusted for the life of the process, and there is no `kty`/`use` filter or duplicate-`kid` handling. The identity token arrives from the token endpoint over pinned TLS and eviction happens on any verification failure, so the exposure is small; a TTL has its own failure modes and would be a design decision rather than a fix.

**Error messages must never interpolate a token, a code, or a verifier.** Every message above carries only a status, a field name, or the JWT library's own message — never a value from `args` or from the response body. The spec has a test for this; treat it as a hard requirement.

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @wimm/api test -- chatgpt-token-exchange
```

Expected: 5 passing.

- [ ] **Step 5: Assert no secret can leak through an error**

Add a test that drives `exchangeCode` into each failure branch and asserts the thrown message contains neither the access token, the refresh token, the code, nor the verifier:

```ts
// Two things went wrong in an earlier draft of this test, and both are easy
// to repeat:
//
// 1. The sentinels were `'at'` and `'rt'`. Both are substrings of ordinary
//    error text -- "ChatGPT" contains "at", "match" contains "at" -- so the
//    assertion failed against CORRECT code.
// 2. The assertions lived inside `.catch()`, so if nothing threw the test
//    passed having asserted nothing at all.
//
// Use sentinels that cannot occur by accident, assert that it DID reject, and
// drive each failure branch separately rather than only one.
const SENTINELS = {
  accessToken: 'SENTINEL-ACCESS-TOKEN-7f3a',
  refreshToken: 'SENTINEL-REFRESH-TOKEN-91bd',
  code: 'SENTINEL-AUTH-CODE-4c2e',
  verifier: 'SENTINEL-PKCE-VERIFIER-6a80',
}

it.each([
  ['a nonce mismatch', { nonce: 'SOMETHING-ELSE' }],
  ['an audience mismatch', { nonce: 'n-1', aud: 'another-client' }],
  ['an issuer mismatch', { nonce: 'n-1', iss: 'https://auth.evil.example' }],
])('never leaks a credential when verification fails on %s', async (_label, claims) => {
  let rejected = false
  await exchangeCode({
    config,
    clientId: 'client-1',
    code: SENTINELS.code,
    verifier: SENTINELS.verifier,
    redirectUri: 'http://127.0.0.1:1/auth/callback',
    nonce: 'n-1',
    fetchImpl: fetchStub({
      access_token: SENTINELS.accessToken,
      refresh_token: SENTINELS.refreshToken,
      id_token: signIdToken(claims),
      expires_in: 3600,
      scope: CHATGPT_SCOPES,
    }),
  }).catch((error: Error) => {
    rejected = true
    for (const secret of Object.values(SENTINELS)) {
      expect(error.message).not.toContain(secret)
    }
  })
  // Without this the test would pass vacuously if the call ever succeeded.
  expect(rejected).toBe(true)
})
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai/local-only/chatgpt-token-exchange.ts apps/api/src/ai/local-only/chatgpt-token-exchange.spec.ts
git commit -m "feat(ai): exchange the ChatGPT code and verify the id_token"
```

---

## Task 7: The encrypted connection store

**Files:**
- Create: `apps/api/src/ai/local-only/chatgpt-connection.store.ts`
- Test: `apps/api/src/ai/local-only/chatgpt-connection.store.spec.ts`

**Interfaces:**
- Consumes: `ChatGptCredentials` (Task 6), the `chatGptConnection` delegate (Task 1), `encryptWithAiKey`/`decryptWithAiKey` from `../ai-key-crypto`
- Produces: `ChatGptConnectionStore` with `load(userId)`, `loadPending(userId)`, `loadClientId(userId)`, `save(userId, clientId, credentials)`, `savePending(userId, credentials)`, `promotePending(userId)`, `clearTokens(userId)`, `status(userId)`

  `save` takes `clientId` separately from the credentials because the durable client ID outlives them: `clearTokens` must null the tokens while retaining it.

**Requirements:**
- Tokens are encrypted with the per-profile secret, exactly as `AiKeyCrypto` already does for the BYOK key.
- `load` on an undecryptable row returns `null` rather than throwing — matching how `AiKeyResolverService` treats a decrypt failure as "no key", which is what makes an exported profile degrade instead of crash.
- `clearTokens` nulls `tokensEncrypted` and `pendingEncrypted` but **retains `clientId` and `accountLabel`**.
- `status` never returns a token — only `{ connected, sharing, accountLabel, expiresAt }`.
- **`refreshToken` is `string | null`** (Task 6). Persist and return `null` as `null`; never coerce it to `''`. A connection with a null refresh token is usable until it expires and then needs a fresh sign-in.

- [ ] **Step 1: Write the failing test**

A real SQLite file from the committed baseline and the real crypto, not a mocked Prisma: a double would prove the store calls methods, not that a token survives a round trip or that what lands on disk is ciphertext.

```ts
// apps/api/src/ai/local-only/chatgpt-connection.store.spec.ts
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
// `@types/better-sqlite3` uses `export =`; import-equals is required for the
// runtime value to resolve, same as `local-route-posture.spec.ts`.
import Database = require('better-sqlite3')
import { LocalPrismaService } from '../../prisma/local/local-prisma.service'
import { generateAiKeyEncryptionSecret } from '../../prisma/local/profile-secret'
import type { PrismaService } from '../../prisma/prisma.service'
import { ChatGptConnectionStore } from './chatgpt-connection.store'
import type { ChatGptCredentials } from './chatgpt-token-exchange'

const ROOT = '/tmp/wimm-chatgpt-connection-store-spec'
const BASELINE = join(
  __dirname,
  '../../../prisma/migrations-sqlite/0000_baseline/migration.sql',
)

function freshDatabaseFile(): string {
  mkdirSync(ROOT, { recursive: true })
  const file = join(ROOT, `${randomUUID()}.db`)
  const db = new Database(file)
  db.exec(readFileSync(BASELINE, 'utf8'))
  db.close()
  return file
}

const ACCESS = 'access-token-value'
const REFRESH = 'refresh-token-value'
const SCOPES = 'openid offline_access chatgpt.tokens.use.direct'

const credentials = (
  overrides: Partial<ChatGptCredentials> = {},
): ChatGptCredentials => ({
  accessToken: ACCESS,
  refreshToken: REFRESH,
  idToken: 'id-token-value',
  expiresAt: new Date(Date.now() + 3_600_000),
  scopes: SCOPES,
  subject: 'sub-1',
  sharing: true,
  ...overrides,
})

describe('ChatGptConnectionStore', () => {
  let prisma: LocalPrismaService
  let store: ChatGptConnectionStore
  let userId: string
  const secret = generateAiKeyEncryptionSecret()

  beforeEach(async () => {
    prisma = new LocalPrismaService(freshDatabaseFile())
    await prisma.onModuleInit()
    userId = randomUUID()
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.com`,
        username: userId,
        passwordHash: 'irrelevant-hash',
      },
    })
    // `LocalPrismaService` is not assignable to `PrismaService`, and ts-jest
    // type-checks specs, so the constructor cannot take it directly. Cast at
    // the seam -- the same one `app.local.module.ts` uses for its
    // `useExisting` binding -- rather than widening the production type.
    store = new ChatGptConnectionStore(
      prisma as unknown as PrismaService,
      secret,
    )
  })

  afterEach(async () => {
    await prisma.onModuleDestroy()
  })

  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('round-trips credentials through encryption', async () => {
    await store.save(userId, 'client-1', credentials())
    const loaded = await store.load(userId)
    expect(loaded?.accessToken).toBe(ACCESS)
    expect(loaded?.refreshToken).toBe(REFRESH)
    expect(loaded?.scopes).toBe(SCOPES)
  })

  it('writes ciphertext, never the plaintext tokens', async () => {
    await store.save(userId, 'client-1', credentials())
    const row = await prisma.chatGptConnection.findUnique({ where: { userId } })
    expect(row?.tokensEncrypted).toBeTruthy()
    expect(row!.tokensEncrypted).not.toContain(ACCESS)
    expect(row!.tokensEncrypted).not.toContain(REFRESH)
    expect(row!.tokensEncrypted).not.toContain('id-token-value')
  })

  it('returns null, not a throw, when the row was encrypted under another secret', async () => {
    await store.save(userId, 'client-1', credentials())
    const foreign = new ChatGptConnectionStore(
      prisma,
      generateAiKeyEncryptionSecret(),
    )
    await expect(foreign.load(userId)).resolves.toBeNull()
  })

  it('keeps clientId and accountLabel when tokens are cleared', async () => {
    await store.save(userId, 'client-1', credentials())
    // Set a label FIRST. Without this the assertion below is vacuous: with
    // no label ever written, `accountLabel` is null before and after, so a
    // `clearTokens` that wrongly nulled it would still pass.
    await prisma.chatGptConnection.update({
      where: { userId },
      data: { accountLabel: 'ada@example.com' },
    })
    await store.clearTokens(userId)
    const row = await prisma.chatGptConnection.findUnique({ where: { userId } })
    expect(row?.clientId).toBe('client-1')
    expect(row?.accountLabel).toBe('ada@example.com')
    expect(row?.tokensEncrypted).toBeNull()
    expect(row?.pendingEncrypted).toBeNull()
    await expect(store.load(userId)).resolves.toBeNull()
  })

  it('never exposes a token through status()', async () => {
    await store.save(userId, 'client-1', credentials())
    const status = await store.status(userId)
    expect(status).toMatchObject({ connected: true, sharing: true })
    const serialized = JSON.stringify(status)
    for (const secretValue of [ACCESS, REFRESH, 'id-token-value']) {
      expect(serialized).not.toContain(secretValue)
    }
  })

  it('promotes a pending rotation and clears the pending slot', async () => {
    await store.save(userId, 'client-1', credentials())
    await store.savePending(
      userId,
      credentials({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh' }),
    )

    // Before promotion the live credential is still the old one.
    expect((await store.load(userId))?.accessToken).toBe(ACCESS)

    await store.promotePending(userId)

    expect((await store.load(userId))?.accessToken).toBe('rotated-access')
    const row = await prisma.chatGptConnection.findUnique({ where: { userId } })
    expect(row?.pendingEncrypted).toBeNull()
  })

  it('round-trips a null refresh token as null, not as an empty string', async () => {
    // Task 6 returns `refreshToken: null` when `offline_access` was not
    // granted. It must survive the JSON round trip as null: coerced to `''`
    // it would later be handed to a refresh grant as a real-looking value
    // and fail at the authorization server instead of here.
    await store.save(userId, 'client-1', credentials({ refreshToken: null }))
    const loaded = await store.load(userId)
    expect(loaded?.refreshToken).toBeNull()
  })

  it('leaves the live credential intact when a rotation is saved but not promoted', async () => {
    await store.save(userId, 'client-1', credentials())
    await store.savePending(userId, credentials({ accessToken: 'rotated-access' }))
    const row = await prisma.chatGptConnection.findUnique({ where: { userId } })
    expect(row?.pendingEncrypted).toBeTruthy()
    expect((await store.load(userId))?.accessToken).toBe(ACCESS)
    await expect(store.loadPending(userId)).resolves.toMatchObject({
      accessToken: 'rotated-access',
    })
  })
})
```

**Why the secret is a constructor argument and not `ConfigService`:** `ai-key-crypto.ts` exports `deriveAiKeyEncryptionKey`/`encryptWithAiKey`/`decryptWithAiKey` as standalone functions precisely so callers outside the `AiKeyCrypto` class can use them (its doc comment records `profile-secret.ts`'s migration path as the reason). The store takes the same `aiKeyEncryptionSecret` string that `AppLocalModule.forRoot` already receives, so nothing new has to be configured.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @wimm/api test -- chatgpt-connection.store
```

- [ ] **Step 3: Implement** the store as an `@Injectable()` over `PrismaService`, serialising `{ accessToken, refreshToken, idToken, expiresAt, scopes, subject, sharing }` to JSON and passing it through `encryptWithAiKey`.

- [ ] **Step 4: Run the test** — expected green.

- [ ] **Step 5: Prove the stored value is really ciphertext**

```bash
pnpm --filter @wimm/api test -- chatgpt-connection.store
```

The ciphertext test must fail if `encryptWithAiKey` is replaced by an identity function. Make that mutation, confirm FAIL, revert, confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai/local-only/chatgpt-connection.store.ts apps/api/src/ai/local-only/chatgpt-connection.store.spec.ts
git commit -m "feat(ai): store ChatGPT credentials under the per-profile secret"
```

---

## Task 8: Single-flight refresh with pending rotation

**Files:**
- Create: `apps/api/src/ai/local-only/chatgpt-refresh.service.ts`
- Test: `apps/api/src/ai/local-only/chatgpt-refresh.service.spec.ts`

**Interfaces:**
- Consumes: `ChatGptConnectionStore` (Task 7), `verifyIdentity` (Task 6), `OidcConfig` (Task 3)
- Produces: `ChatGptRefreshService.accessTokenFor(userId): Promise<string | null>`

**Requirements:**
- **Single-flight per user.** Several categorize calls in one import batch must share one in-flight refresh. Follow the desktop renderer's existing single-flight-with-queue interceptor pattern; do not invent a second one.
- `grant_type=refresh_token` with `client_id`, `refresh_token`, `resource`.
- **A refresh response may omit `scope`.** Fall back to the stored scopes; do not treat the omission as a scope downgrade. Task 6 applies the same RFC 6749 §5.1 fallback on the initial exchange — keep the two consistent.
- **A stored `refreshToken` of `null` means this connection cannot be refreshed.** Return `null` immediately rather than posting a grant with no token.
- **Pending rotation:** persist rotated credentials via `savePending` *before* verifying the new `id_token`; `promotePending` only after verification succeeds. If verification fails because the signing-key service is unavailable, leave the pending state in place and return a retryable error — a later call, including after a restart, resumes from it rather than replaying a consumed refresh token.
- **Call `verifyIdentity` with `nonce: null` and `verifyAt: <when the rotation was received>`.** Both arguments exist for this task specifically, and both were added to Task 6 after review:
  - **`nonce: null`** — a refresh has no new authorize request, so there is no nonce to compare. `null` is the only way to say that; `undefined` and `''` are refused, so "forgot to pass it" can never be mistaken for "deliberately absent". Task 6's guard would otherwise reject every refresh outright.
  - **`verifyAt`** — store the receipt time alongside the pending rotation and verify against it. A signing-key outage can outlast the identity token *without* invalidating the refresh token, so verifying a resumed rotation against the current clock fails permanently, on a refresh token that has already been consumed. That is precisely the "account that silently cannot reconnect" this pending-state design exists to prevent, and it is the subtlety the reference implementation encodes as `receivedAt`.

- [ ] **Step 1: Write the failing test**

The store is doubled here (Task 7 already proves the real one against a real database); what this spec must prove is *call discipline* — how many network refreshes happen, and what survives a failure.

```ts
// apps/api/src/ai/local-only/chatgpt-refresh.service.spec.ts
import { ChatGptRefreshService } from './chatgpt-refresh.service'
import type { ChatGptCredentials } from './chatgpt-token-exchange'
import type { OidcConfig } from './chatgpt-oidc'

const config: OidcConfig = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/authorize',
  token_endpoint: 'https://auth.openai.com/oauth/token',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  revocation_endpoint: 'https://auth.openai.com/oauth/revoke',
}

const SCOPES = 'openid offline_access chatgpt.tokens.use.direct'
const USER = 'user-1'

/** Minimal in-memory stand-in for `ChatGptConnectionStore`. */
class StoreDouble {
  current: ChatGptCredentials | null = null
  pending: ChatGptCredentials | null = null
  clientId: string | null = 'client-1'
  cleared = 0

  async load() { return this.current }
  async loadPending() { return this.pending }
  async loadClientId() { return this.clientId }
  async save(_u: string, _c: string, credentials: ChatGptCredentials) {
    this.current = credentials
    this.pending = null
  }
  async savePending(_u: string, credentials: ChatGptCredentials) {
    this.pending = credentials
  }
  async promotePending() {
    if (this.pending) this.current = this.pending
    this.pending = null
  }
  async clearTokens() {
    this.current = null
    this.pending = null
    this.cleared += 1
  }
}

const expired = (): ChatGptCredentials => ({
  accessToken: 'old-access',
  refreshToken: 'old-refresh' as string | null,
  idToken: 'old-id',
  // Already past: forces a refresh on the next access.
  expiresAt: new Date(Date.now() - 1_000),
  scopes: SCOPES,
  subject: 'sub-1',
  sharing: true,
})

/** Counts token-endpoint POSTs so single-flight is measured, not assumed. */
function tokenEndpointSpy(
  respond: (body: URLSearchParams) => { ok: boolean; body: unknown },
) {
  const calls: URLSearchParams[] = []
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url !== config.token_endpoint) {
      throw new Error(`unexpected fetch to ${url}`)
    }
    const body = new URLSearchParams(String(init?.body))
    calls.push(body)
    const { ok, body: payload } = respond(body)
    return { ok, status: ok ? 200 : 400, json: async () => payload }
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

// Matches the real `verifyIdentity`'s shape closely enough that a call with
// the wrong arguments fails to type-check here too.
type VerifyIdentity = (args: {
  idToken: string
  clientId: string
  issuer: string
  jwksUri: string
  nonce: string | null
  verifyAt?: Date
}) => Promise<{ subject: string }>

const build = (
  store: StoreDouble,
  fetchImpl: typeof fetch,
  verifyIdentity: VerifyIdentity = async () => ({ subject: 'sub-1' }),
) =>
  new ChatGptRefreshService({
    store: store as never,
    discover: async () => config,
    fetchImpl,
    verifyIdentity,
  })

describe('ChatGptRefreshService', () => {
  it('refreshes once for many concurrent callers (single-flight)', async () => {
    const store = new StoreDouble()
    store.current = expired()
    const { calls, fetchImpl } = tokenEndpointSpy(() => ({
      ok: true,
      body: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        id_token: 'new-id',
        expires_in: 3600,
        scope: SCOPES,
      },
    }))
    const service = build(store, fetchImpl)

    const tokens = await Promise.all(
      Array.from({ length: 10 }, () => service.accessTokenFor(USER)),
    )

    expect(calls).toHaveLength(1)
    expect(new Set(tokens)).toEqual(new Set(['new-access']))
  })

  it('sends the documented refresh grant fields', async () => {
    const store = new StoreDouble()
    store.current = expired()
    const { calls, fetchImpl } = tokenEndpointSpy(() => ({
      ok: true,
      body: { access_token: 'a', refresh_token: 'r', id_token: 'i', expires_in: 60, scope: SCOPES },
    }))
    await build(store, fetchImpl).accessTokenFor(USER)

    expect(Object.fromEntries(calls[0]!)).toMatchObject({
      grant_type: 'refresh_token',
      client_id: 'client-1',
      refresh_token: 'old-refresh',
      resource: 'https://api.openai.com/v1',
    })
  })

  it('keeps the stored scopes when the response omits scope', async () => {
    const store = new StoreDouble()
    store.current = expired()
    const { fetchImpl } = tokenEndpointSpy(() => ({
      ok: true,
      // No `scope` key at all -- OAuth may omit it when nothing changed.
      body: { access_token: 'a', refresh_token: 'r', id_token: 'i', expires_in: 60 },
    }))
    await build(store, fetchImpl).accessTokenFor(USER)

    expect(store.current?.scopes).toBe(SCOPES)
    expect(store.current?.sharing).toBe(true)
  })

  it('leaves the rotation pending and the old row intact when verification fails', async () => {
    const store = new StoreDouble()
    const before = expired()
    store.current = before
    const { calls, fetchImpl } = tokenEndpointSpy(() => ({
      ok: true,
      body: { access_token: 'new-access', refresh_token: 'new-refresh', id_token: 'new-id', expires_in: 60, scope: SCOPES },
    }))
    const service = build(store, fetchImpl, async () => {
      throw new Error('identity verification unavailable')
    })

    await expect(service.accessTokenFor(USER)).rejects.toThrow(/verification/i)

    expect(store.pending?.accessToken).toBe('new-access')
    expect(store.current).toBe(before)
    expect(store.cleared).toBe(0)
    expect(calls).toHaveLength(1)
  })

  it('resumes from the pending rotation without consuming the refresh token twice', async () => {
    const store = new StoreDouble()
    store.current = expired()
    const { calls, fetchImpl } = tokenEndpointSpy(() => ({
      ok: true,
      body: { access_token: 'new-access', refresh_token: 'new-refresh', id_token: 'new-id', expires_in: 60, scope: SCOPES },
    }))

    let verifyShouldFail = true
    const service = build(store, fetchImpl, async () => {
      if (verifyShouldFail) throw new Error('identity verification unavailable')
      return { subject: 'sub-1' }
    })

    await expect(service.accessTokenFor(USER)).rejects.toThrow()
    verifyShouldFail = false

    await expect(service.accessTokenFor(USER)).resolves.toBe('new-access')

    // The second call verified the saved pending state; it did NOT post a
    // second refresh grant with an already-consumed refresh token.
    expect(calls).toHaveLength(1)
    expect(store.pending).toBeNull()
  })

  it('verifies the rotation with a null nonce and the receipt time', async () => {
    // A double accepts anything, so without this the two arguments that make
    // refresh work at all would be unpinned.
    const store = new StoreDouble()
    store.current = expired()
    const { fetchImpl } = tokenEndpointSpy(() => ({
      ok: true,
      body: { access_token: 'a', refresh_token: 'r', id_token: 'i', expires_in: 60, scope: SCOPES },
    }))
    const seen: Array<{ nonce: string | null; verifyAt?: Date }> = []
    const service = build(store, fetchImpl, async (args) => {
      seen.push({ nonce: args.nonce, verifyAt: args.verifyAt })
      return { subject: 'sub-1' }
    })

    await service.accessTokenFor(USER)

    expect(seen).toHaveLength(1)
    // `null`, not undefined and not '': Task 6 refuses both.
    expect(seen[0]!.nonce).toBeNull()
    expect(seen[0]!.verifyAt).toBeInstanceOf(Date)
  })

  it('clears the connection and returns null when the refresh token is rejected', async () => {
    const store = new StoreDouble()
    store.current = expired()
    const { fetchImpl } = tokenEndpointSpy(() => ({
      ok: false,
      body: { error: 'invalid_grant' },
    }))

    await expect(build(store, fetchImpl).accessTokenFor(USER)).resolves.toBeNull()
    expect(store.cleared).toBe(1)
  })

  it('does not refresh a token that is still valid', async () => {
    const store = new StoreDouble()
    store.current = { ...expired(), expiresAt: new Date(Date.now() + 3_600_000), accessToken: 'still-good' }
    const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: {} }))

    await expect(build(store, fetchImpl).accessTokenFor(USER)).resolves.toBe('still-good')
    expect(calls).toHaveLength(0)
  })

  it('returns null without attempting a grant when the stored refresh token is null', async () => {
    // Task 6 yields `refreshToken: null` when `offline_access` was not
    // granted. Posting a refresh grant with no token would be a guaranteed
    // round trip to a 400; fail locally instead.
    const store = new StoreDouble()
    store.current = { ...expired(), refreshToken: null }
    const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: {} }))

    await expect(build(store, fetchImpl).accessTokenFor(USER)).resolves.toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('returns null when there is no connection at all', async () => {
    const store = new StoreDouble()
    store.current = null
    store.clientId = null
    const { calls, fetchImpl } = tokenEndpointSpy(() => ({ ok: true, body: {} }))

    await expect(build(store, fetchImpl).accessTokenFor(USER)).resolves.toBeNull()
    expect(calls).toHaveLength(0)
  })
})
```

**Constructor shape:** `ChatGptRefreshService` takes its collaborators as one object (`{ store, discover, fetchImpl, verifyIdentity }`) so the spec can substitute each without a DI container. In `local-only-ai.module.ts`, wire it with a factory that supplies the real store, `discoverOidcConfig`, global `fetch`, and `verifyIdentity` from Task 6.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @wimm/api test -- chatgpt-refresh
```

- [ ] **Step 3: Implement** with a `Map<string, Promise<string | null>>` keyed by `userId`, deleted in a `finally`.

- [ ] **Step 4: Run the test** — expected green.

- [ ] **Step 5: Prove single-flight is real**

Remove the in-flight map and re-run: the ten-concurrent-callers test must FAIL with ten refresh calls. Restore it and confirm one.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai/local-only/chatgpt-refresh.service.ts apps/api/src/ai/local-only/chatgpt-refresh.service.spec.ts
git commit -m "feat(ai): refresh ChatGPT tokens single-flight with pending rotation"
```

---

## Task 9: The provider

**Files:**
- Create: `apps/api/src/ai/local-only/chatgpt-oauth-provider.ts`
- Delete: `apps/api/src/ai/local-only/chatgpt-oauth-provider.stub.ts`
- Modify: `apps/api/src/ai/local-only/local-only-ai.module.ts`
- Test: `apps/api/src/ai/local-only/chatgpt-oauth-provider.spec.ts`

**Interfaces:**
- Consumes: `ChatGptRefreshService` (Task 8), the `AiProvider` contract as changed in Task 2
- Produces: `ChatGptOAuthProvider` with `readonly id = 'chatgpt-oauth'`

**Requirements:**
- `POST https://api.openai.com/v1/responses`, header `authorization: Bearer <access token>`, body carrying **`store: false`**.
- Reuse the Anthropic provider's prompt shape and result parsing; do not invent a second output format.
- Return `[]` when no connection exists, when `sharing` is false, or when the token cannot be refreshed. Categorization is an enhancement and must never gate an import.
- **Map the API's own error codes** to the design's failure table. These are the real codes, with their retryability:

| API error code | Meaning | Retryable |
|---|---|---|
| `subscription_sharing_user_not_eligible` | That account or workspace cannot use plan sharing | no |
| `subscription_sharing_usage_limit_exceeded` | A sharing limit was reached — the user's own usage/app limits in ChatGPT Settings | no |
| `subscription_sharing_usage_unavailable` | Usage could not be checked | **yes** |
| `subscription_sharing_unsupported_capability` | The request used a capability sharing does not support | no |
| `subscription_sharing_route_not_supported` | The request used an unsupported route | no |
| `subscription_sharing_invalid_user` | The subscription context could not be validated | no |
| `subscription_sharing_user_unavailable` | Account or workspace temporarily unavailable | **yes** |

`subscription_sharing_usage_limit_exceeded` is the weekly/per-app cap row in the design's failure table. Do not collapse these into one message, and do not retry a non-retryable code.

- [ ] **Step 1: Write the failing test**, including the privacy assertion:

```ts
it('sends store: false so the transaction data is not retained', async () => {
  const bodies: unknown[] = []
  const spyFetch = (async (_input: string | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return { ok: true, json: async () => ({ output_text: '[]' }) }
  }) as unknown as typeof fetch
  // ... construct the provider with spyFetch and a stub refresh service
  expect(bodies[0]).toMatchObject({ store: false })
})
```

Also cover: `[]` when `sharing` is false; `[]` when the refresh service returns `null`; the `Authorization` header carries the access token; a non-OK response produces an error whose message contains no token.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @wimm/api test -- chatgpt-oauth-provider
```

- [ ] **Step 3: Implement**, then delete the stub and register the real provider into `AI_PROVIDERS` in `local-only-ai.module.ts`.

- [ ] **Step 4: Run the suite and the composition guard**

```bash
pnpm --filter @wimm/api test && pnpm --filter @wimm/api verify:ai-hosted-composition
```

Expected: green, and the guard exits 0 — the real provider must be no more reachable from `app.module.ts` than the stub was.

- [ ] **Step 5: Prove the guard still bites**

Temporarily add `import { LocalOnlyAiModule } from './ai/local-only/local-only-ai.module'` to `app.module.ts` and add it to `imports`. Re-run `verify:ai-hosted-composition`: it must exit 1 and name both `chatgpt-oauth-provider.ts` and `local-only-ai.module.ts`. Revert and confirm exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai/local-only/chatgpt-oauth-provider.ts apps/api/src/ai/local-only/chatgpt-oauth-provider.spec.ts apps/api/src/ai/local-only/local-only-ai.module.ts
git commit -m "feat(ai): implement the ChatGPT plan-usage provider"
```

---

## Task 10: Connect / status / disconnect routes

**Files:**
- Create: `apps/api/src/ai/local-only/chatgpt-connect-flow.ts`
- Create: `apps/api/src/ai/local-only/chatgpt.controller.ts`
- Modify: `apps/api/src/ai/local-only/local-only-ai.module.ts`
- Modify: `apps/api/src/app.local.module.ts` — add `openBrowser` to `AppLocalModuleOptions`
- Test: `apps/api/src/ai/local-only/chatgpt.controller.spec.ts`
- Verify: `apps/api/src/profile/local-route-posture.spec.ts` picks the new routes up automatically

**Ordering note:** this task introduces the `openBrowser` option because it is the consumer of it; Task 11 supplies the real `shell.openExternal` implementation and adds the compose-time refusal. Declaring the option here is what lets this task's spec pass `openBrowser: async () => undefined` without depending on a later task.

**Interfaces:**
- Produces: `POST /api/ai/chatgpt/connect`, `GET /api/ai/chatgpt/status`, `POST /api/ai/chatgpt/disconnect`

**Requirements:**
- `connect` runs discovery, starts the listener, calls the injected `openBrowser`, awaits the callback, exchanges, stores, and returns **status only**.
- `status` returns `{ connected, sharing, accountLabel, expiresAt }` — never a token.
- Validate every input with `class-validator`; keep controllers thin with the logic in the services from Tasks 3-8.
- The existing `SessionTokenGuard` posture must cover these routes; `local-route-posture.spec.ts` walks the real Express stack, so any route added to `AppLocalModule` is covered automatically.

- [ ] **Step 1: Write the failing test**

Boots the real local composition over a real SQLite file, the same way `local-route-posture.spec.ts` does, and overrides only the one collaborator that would otherwise open a browser and wait for a human. Note the **unprefixed** paths: these specs do not call `setGlobalPrefix`, matching `app.local.module.spec.ts`.

```ts
// apps/api/src/ai/local-only/chatgpt.controller.spec.ts
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import Database = require('better-sqlite3')
import { AppLocalModule } from '../../app.local.module'
import { LocalPrismaService } from '../../prisma/local/local-prisma.service'
import { generateAiKeyEncryptionSecret } from '../../prisma/local/profile-secret'
import { generateSessionToken, SESSION_TOKEN_HEADER } from '../../profile/session-token'
import { ChatGptConnectFlow } from './chatgpt-connect-flow'

const ROOT = '/tmp/wimm-chatgpt-controller-spec'
const BASELINE = join(
  __dirname,
  '../../../prisma/migrations-sqlite/0000_baseline/migration.sql',
)
const SECRET_KEYS = ['accessToken', 'refreshToken', 'idToken', 'access_token', 'refresh_token', 'id_token']

function freshDatabaseFile(): string {
  mkdirSync(ROOT, { recursive: true })
  const file = join(ROOT, `${randomUUID()}.db`)
  const db = new Database(file)
  db.exec(readFileSync(BASELINE, 'utf8'))
  db.close()
  return file
}

async function seedUser(file: string): Promise<string> {
  const seeding = new LocalPrismaService(file)
  await seeding.onModuleInit()
  try {
    const id = randomUUID()
    await seeding.user.create({
      data: {
        id,
        email: 'chatgpt-controller-spec@example.com',
        username: 'chatgpt-controller-spec',
        passwordHash: 'irrelevant-hash',
      },
    })
    return id
  } finally {
    await seeding.onModuleDestroy()
  }
}

/** Recursively assert no credential-shaped key appears anywhere. */
function assertNoCredentialKeys(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(assertNoCredentialKeys)
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      expect(SECRET_KEYS).not.toContain(key)
      assertNoCredentialKeys(nested)
    }
  }
}

describe('ChatGpt controller (behavioral, over the real local composition)', () => {
  let app: INestApplication
  let baseUrl: string
  const sessionToken = generateSessionToken()
  const aiKeyEncryptionSecret = generateAiKeyEncryptionSecret()
  const flow = {
    connected: [] as string[],
    async connect(userId: string) {
      this.connected.push(userId)
      return { connected: true, sharing: true, accountLabel: 'ada@example.com', expiresAt: null }
    },
  }

  beforeAll(async () => {
    const file = freshDatabaseFile()
    await seedUser(file)

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        AppLocalModule.forRoot({
          databaseFile: file,
          sessionToken,
          aiKeyEncryptionSecret,
          openBrowser: async () => undefined,
        }),
      ],
    })
      // The only override: the real flow opens a system browser and waits
      // for a human. Its pieces are proven in Tasks 3-8.
      .overrideProvider(ChatGptConnectFlow)
      .useValue(flow)
      .compile()

    app = moduleRef.createNestApplication({ logger: false })
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    const server = await app.listen(0, '127.0.0.1')
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await app.close()
    rmSync(ROOT, { recursive: true, force: true })
  })

  const call = (path: string, method = 'GET', withToken = true) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: withToken ? { [SESSION_TOKEN_HEADER]: sessionToken } : {},
    })

  it('reports disconnected before any connection exists', async () => {
    const response = await call('/ai/chatgpt/status')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ connected: false, sharing: false })
  })

  it('never returns a credential from status', async () => {
    const body: unknown = await (await call('/ai/chatgpt/status')).json()
    assertNoCredentialKeys(body)
    expect(JSON.stringify(body)).not.toMatch(/Bearer|eyJ/)
  })

  it('returns status only from connect, and never a credential', async () => {
    const response = await call('/ai/chatgpt/connect', 'POST')
    expect(response.status).toBeLessThan(400)
    const body: unknown = await response.json()
    expect(body).toMatchObject({ connected: true, sharing: true })
    assertNoCredentialKeys(body)
    expect(flow.connected).toHaveLength(1)
  })

  it('reports disconnected after disconnect', async () => {
    expect((await call('/ai/chatgpt/disconnect', 'POST')).status).toBeLessThan(400)
    await expect((await call('/ai/chatgpt/status')).json()).resolves.toMatchObject({
      connected: false,
    })
  })

  it('rejects every route without the session token', async () => {
    for (const [path, method] of [
      ['/ai/chatgpt/status', 'GET'],
      ['/ai/chatgpt/connect', 'POST'],
      ['/ai/chatgpt/disconnect', 'POST'],
    ] as const) {
      expect((await call(path, method, false)).status).toBe(401)
    }
  })
})
```

**Carry-overs from Task 7.** Two things the store deliberately does not do, which this task owns:
- **Wiring its encryption secret.** `ChatGptConnectionStore` takes `aiKeyEncryptionSecret: string` as a constructor argument, and Nest cannot resolve a `string` from its type. Bind it with a `useFactory` (or an injection token) fed from `AppLocalModuleOptions.aiKeyEncryptionSecret` — the same value `AppLocalModule.forRoot` already receives. Until that exists the store cannot be injected at all.
- **Writing `accountLabel`.** The store only *retains* it across a disconnect; nothing ever sets it. The connect flow here must, or the UI has no account to name.

**Carry-over from Task 5.** A denied consent redirects back with `error=access_denied` and **no** `code`, so the listener surfaces it as a missing-code failure and the authorization server's own reason is lost. Read `error`/`error_description` from the callback in this flow and map a denial to its own message — "you declined" is not "something went wrong". Also accepted knowingly from Task 5: because the listener closes on the first request, any local process (or a web page in the user's browser) can end a sign-in attempt with one request to the port. It cannot forge a success without the armed `state`, and keeping the listener open after a bad request would be the worse trade.

**Carry-over from Task 2 that this task must resolve.** `ImportsService` now gates AI work on the user's `aiCategorizationMode`, which defaults to `OFF`. No task in this plan currently sets that mode, so a user who connects ChatGPT but never changes the mode would be silently skipped once `ImportsService` is routed to this provider. Decide it here, explicitly, and state the decision in the connect flow's doc comment: either a successful connect sets the mode, or the gate must also treat a live ChatGPT connection as consent. Do not leave it implicit — the gate is harmless today only because this provider is unreachable from `ImportsService`.

**`ChatGptConnectFlow`** is the service the controller delegates to: it runs discovery, starts the listener, calls `openBrowser`, awaits the callback, exchanges, and persists. Create it in this task as a thin composition of Tasks 3-8; the controller itself must hold no logic.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @wimm/api test -- chatgpt.controller
```

- [ ] **Step 3: Implement** the controller and register it.

- [ ] **Step 4: Run the suite including route posture**

```bash
pnpm --filter @wimm/api test
```

Expected: green, including the 7 route-posture tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(ai): add ChatGPT connect, status and disconnect routes"
```

---

## Task 11: Desktop main — the one Electron-dependent piece

**Files:**
- Create: `apps/desktop/src/main/chatgpt-browser.ts`
- Modify: `apps/desktop/src/main/local-api.ts` (pass `openBrowser` into `AppLocalModule.forRoot`)
- Modify: `apps/api/src/app.local.module.ts` (refuse to compose without `openBrowser`)
- Modify: `apps/api/src/app.local.module.spec.ts`
- Test: `apps/desktop/src/main/chatgpt-browser.spec.ts`

**Interfaces:**
- Consumes: `AppLocalModuleOptions.openBrowser`, declared in Task 10
- Produces: `openChatGptAuthorizeUrl(url: string): Promise<void>`, passed in as that option from `local-api.ts`

**Requirements:**
- `shell.openExternal` only. **No `BrowserWindow`.**
- Refuse any URL whose origin is not the discovered issuer's origin. An `openExternal` that forwards an arbitrary string is a navigation primitive handed to whatever can reach it.
- `AppLocalModule.forRoot` must follow the existing assert-then-refuse contract: refuse to compose when `openBrowser` is missing, the same way `assertUsableSessionToken` and `assertUsableAiKeyEncryptionSecret` already do, so a misconfiguration is a boot failure that names itself.

- [ ] **Step 1: Write the failing test**

`electron` cannot be imported outside a real Electron process, so this follows `updater.spec.ts` exactly: `jest.resetModules()` plus **`jest.doMock`, never the hoisted `jest.mock`**, then `require` the module under test.

```ts
// apps/desktop/src/main/chatgpt-browser.spec.ts
type BrowserModule = typeof import('./chatgpt-browser')

function load() {
  jest.resetModules()
  const opened: string[] = []
  // Mutable counter shared with the mock below; read through a method so the
  // test observes the live value rather than a copy taken at load time.
  const constructed = { count: 0 }

  jest.doMock('electron', () => ({
    shell: {
      openExternal: async (url: string) => {
        opened.push(url)
      },
    },
    // Present so that constructing one is observable rather than an
    // undefined crash -- the point is proving it never happens.
    BrowserWindow: class {
      constructor() {
        constructed.count += 1
      }
    },
  }))

  const mod = require('./chatgpt-browser') as BrowserModule
  return {
    openChatGptAuthorizeUrl: mod.openChatGptAuthorizeUrl,
    opened,
    browserWindowsConstructed: () => constructed.count,
  }
}

describe('openChatGptAuthorizeUrl', () => {
  it('opens an issuer-origin URL in the system browser', async () => {
    const harness = load()
    const url = 'https://auth.openai.com/authorize?client_id=dynamic_agent_client&state=s'
    await harness.openChatGptAuthorizeUrl(url)
    expect(harness.opened).toEqual([url])
  })

  it('never constructs a BrowserWindow', async () => {
    const harness = load()
    await harness.openChatGptAuthorizeUrl('https://auth.openai.com/authorize')
    expect(harness.browserWindowsConstructed()).toBe(0)
  })

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://auth.openai.com.evil.example/authorize',
    'https://evil.example/authorize',
    'http://auth.openai.com/authorize',
    'not-a-url',
  ])('refuses %s without opening anything', async (hostile) => {
    const harness = load()
    await expect(harness.openChatGptAuthorizeUrl(hostile)).rejects.toThrow()
    expect(harness.opened).toEqual([])
  })
})
```

Note `https://auth.openai.com.evil.example` and plain `http://`: a naive `startsWith('https://auth.openai.com')` check passes the first and a naive hostname check passes the second. Compare the parsed `origin` against `https://auth.openai.com` exactly.

`AppLocalModule.forRoot` must also refuse to compose without `openBrowser`. Add that to `app.local.module.spec.ts` alongside the existing session-token and secret refusals:

```ts
it('refuses to compose without an openBrowser callback', async () => {
  await expect(
    Test.createTestingModule({
      imports: [
        AppLocalModule.forRoot({
          databaseFile: freshDatabaseFile('no-open-browser'),
          sessionToken,
          aiKeyEncryptionSecret,
          // `openBrowser` deliberately omitted.
        } as never),
      ],
    }).compile(),
  ).rejects.toThrow(/openBrowser/)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @wimm/desktop test -- chatgpt-browser
```

- [ ] **Step 3: Implement** the guard and wire it through `local-api.ts`.

- [ ] **Step 4: Confirm `apps/api` stayed Electron-free**

```bash
grep -rn "from 'electron'" apps/api/src || echo "clean: no electron import in apps/api"
```

Expected: `clean: no electron import in apps/api`.

- [ ] **Step 5: Run both suites**

```bash
pnpm --filter @wimm/api test && pnpm --filter @wimm/desktop test
```

Expected: api green; desktop green (baseline: 8 suites / 111 tests, plus the new ones).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/desktop/src
git commit -m "feat(desktop): open the ChatGPT authorize URL in the system browser"
```

---

## Task 12: Failure-state mapping, locales, and the connection UI

**Files:**
- Create: `apps/desktop/src/renderer/lib/chatgpt-connection-state.ts`
- Test: `apps/desktop/src/renderer/lib/chatgpt-connection-state.spec.ts`
- Create: `apps/desktop/src/renderer/lib/locale-parity.spec.ts`
- Modify: `apps/desktop/src/renderer/i18n/locales/en.json`, `.../pt.json`
- Create: `apps/desktop/src/renderer/components/settings/ChatGptConnection.tsx`
- Modify: the settings screen that hosts AI preferences

**Interfaces:**
- Produces: `describeChatGptState(input: { connected: boolean; sharing: boolean; online: boolean; errorCode?: string }): { messageKey: string; retryable: boolean; tone: 'invite' | 'info' | 'error' }`

**Why the logic is extracted instead of tested through the component:** `apps/desktop/jest.config.js` sets `testEnvironment: 'node'`, its `roots` are `src/main` and `src/renderer/lib` only, and `testMatch` is `**/*.spec.ts` — not `.tsx`. Its own doc comment records that component-level testing (jsdom, React Testing Library) "remains future scope, not something this change introduces." Adding jsdom and RTL would be two new top-level dependencies, which `AGENTS.md` requires asking about, and a test-infrastructure change this feature does not need. So all the decision logic lives in `renderer/lib/` where the existing harness already reaches it (`api-mode.spec.ts`, `csv-mapping-format.spec.ts`, `local-api-adapter.spec.ts` are the precedent), and the component becomes a thin renderer of its output.

**This is stated rather than hidden:** `ChatGptConnection.tsx` itself carries no automated test under this plan, exactly as every other renderer component in this repository currently does. If component tests are wanted, that is its own task with its own dependency decision.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/renderer/lib/chatgpt-connection-state.spec.ts
import { describeChatGptState } from './chatgpt-connection-state'

const base = { connected: true, sharing: true, online: true }

describe('describeChatGptState', () => {
  it('invites connection rather than reporting an error when never connected', () => {
    const state = describeChatGptState({ ...base, connected: false, sharing: false })
    expect(state.tone).toBe('invite')
    expect(state.messageKey).toBe('ai.chatgpt.notConnected')
  })

  it('says the plan does not include sharing, and that retrying will not help', () => {
    const state = describeChatGptState({ ...base, sharing: false })
    expect(state.messageKey).toBe('ai.chatgpt.sharingNotEnabled')
    expect(state.retryable).toBe(false)
  })

  it('keeps the app usable when offline', () => {
    const state = describeChatGptState({ ...base, online: false })
    expect(state.messageKey).toBe('ai.chatgpt.offline')
    expect(state.tone).toBe('info')
    expect(state.retryable).toBe(true)
  })

  // The real API error codes, with the retryability the API itself defines.
  it.each([
    ['subscription_sharing_user_not_eligible', 'ai.chatgpt.notEligible', false],
    ['subscription_sharing_usage_limit_exceeded', 'ai.chatgpt.limitReached', false],
    ['subscription_sharing_usage_unavailable', 'ai.chatgpt.usageUnavailable', true],
    ['subscription_sharing_unsupported_capability', 'ai.chatgpt.unsupportedCapability', false],
    ['subscription_sharing_route_not_supported', 'ai.chatgpt.routeNotSupported', false],
    ['subscription_sharing_invalid_user', 'ai.chatgpt.invalidUser', false],
    ['subscription_sharing_user_unavailable', 'ai.chatgpt.userUnavailable', true],
  ])('maps %s to its own message', (errorCode, messageKey, retryable) => {
    const state = describeChatGptState({ ...base, errorCode })
    expect(state.messageKey).toBe(messageKey)
    expect(state.retryable).toBe(retryable)
  })

  it('gives every distinct cause a distinct message', () => {
    const inputs = [
      { ...base, connected: false, sharing: false },
      { ...base, sharing: false },
      { ...base, online: false },
      { ...base, errorCode: 'subscription_sharing_user_not_eligible' },
      { ...base, errorCode: 'subscription_sharing_usage_limit_exceeded' },
      { ...base, errorCode: 'subscription_sharing_usage_unavailable' },
      { ...base, errorCode: 'subscription_sharing_unsupported_capability' },
      { ...base, errorCode: 'subscription_sharing_route_not_supported' },
      { ...base, errorCode: 'subscription_sharing_invalid_user' },
      { ...base, errorCode: 'subscription_sharing_user_unavailable' },
    ]
    const keys = inputs.map((input) => describeChatGptState(input).messageKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('falls back to a generic message for an unknown error code', () => {
    const state = describeChatGptState({ ...base, errorCode: 'something_new_from_openai' })
    expect(state.messageKey).toBe('ai.chatgpt.unknownError')
    expect(state.retryable).toBe(true)
  })

  it('reports a healthy connection', () => {
    expect(describeChatGptState(base).messageKey).toBe('ai.chatgpt.connected')
  })
})
```

The distinct-message test is the one that matters: it is what stops a later refactor from quietly collapsing seven causes into "AI unavailable", which the design document names as a conflation this project has already fixed three times elsewhere.

```ts
// apps/desktop/src/renderer/lib/locale-parity.spec.ts
import en from '../i18n/locales/en.json'
import pt from '../i18n/locales/pt.json'

/** Every leaf key path, so a nested key cannot drift unnoticed. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix]
  }
  return Object.entries(value).flatMap(([key, nested]) =>
    keyPaths(nested, prefix ? `${prefix}.${key}` : key),
  )
}

describe('locale parity', () => {
  it('defines exactly the same keys in en and pt', () => {
    const inEn = new Set(keyPaths(en))
    const inPt = new Set(keyPaths(pt))
    expect([...inEn].filter((key) => !inPt.has(key))).toEqual([])
    expect([...inPt].filter((key) => !inEn.has(key))).toEqual([])
  })

  it('leaves no value empty in either locale', () => {
    for (const [name, bundle] of [['en', en], ['pt', pt]] as const) {
      for (const path of keyPaths(bundle)) {
        const value = path
          .split('.')
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], bundle)
        expect(typeof value === 'string' && value.trim().length > 0).toBe(true)
        if (typeof value !== 'string' || !value.trim()) {
          throw new Error(`${name} has an empty value at ${path}`)
        }
      }
    }
  })
})
```

This parity spec guards every existing key too, not just the ones this task adds. If it fails on pre-existing drift, fix the drift — that is a real defect, not noise from this task.

- [ ] **Step 2: Run both and watch them fail**

```bash
pnpm --filter @wimm/desktop test -- chatgpt-connection-state locale-parity
```

Expected: FAIL — `./chatgpt-connection-state` cannot be resolved. If `locale-parity` fails on existing keys, record what it found before fixing.

- [ ] **Step 3: Confirm `resolveJsonModule` is on, or turn it on**

```bash
grep -n "resolveJsonModule" apps/desktop/tsconfig.spec.json apps/desktop/tsconfig*.json
```

The parity spec imports JSON. If `resolveJsonModule` is absent from `tsconfig.spec.json`, add `"resolveJsonModule": true` to it — that file is spec-only and does not drive the electron-vite build.

- [ ] **Step 4: Implement the mapping and add both locales**

`describeChatGptState` is a pure function: a lookup table from error code to `{ messageKey, retryable }`, with `connected`/`sharing`/`online` checked first. Add every `ai.chatgpt.*` key to **both** `en.json` and `pt.json`.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @wimm/desktop test -- chatgpt-connection-state locale-parity
```

Expected: all passing, including the ten-distinct-messages assertion.

- [ ] **Step 6: Build the component on top of it**

`ChatGptConnection.tsx`: React Query for `GET /api/ai/chatgpt/status` through the single existing `axios` instance (do not add a second); components from `renderer/components/ui/`; colours only via tokens from `renderer/styles/theme.css`. Render `describeChatGptState(...)`'s `messageKey` through `useTranslation`, and show a retry affordance only when `retryable` is true.

- [ ] **Step 7: Verify the renderer never receives a credential**

```bash
grep -rnE "accessToken|refreshToken|idToken" apps/desktop/src/renderer || echo "clean: no credential field named in the renderer"
```

Expected: `clean: ...`. The API's status payload has no such field (Task 10 asserts this recursively); this check catches a renderer that reaches for one anyway.

- [ ] **Step 8: Lint and commit**

```bash
pnpm --filter @wimm/desktop lint && pnpm --filter @wimm/desktop test
```

```bash
git add apps/desktop/src
git commit -m "feat(desktop): map ChatGPT failure states and add the connection UI"
```

---

## Task 13: Full sweep and the packaging guard

**Files:** none created; this task is verification.

- [ ] **Step 1: Run every suite and every assertion**

```bash
pnpm --filter @wimm/api test \
 && pnpm --filter @wimm/desktop test \
 && pnpm --filter @wimm/shared test \
 && pnpm --filter @wimm/api assert:parity \
 && pnpm --filter @wimm/api verify:ai-hosted-composition \
 && pnpm lint \
 && pnpm build
```

Expected: all green. Baselines before this plan: api 67 suites / 596 tests, desktop 8 / 111, shared 34, scripts 14, route posture 7, parity 3/3, build 3/3, lint 6/6.

`assert:constraints` is deliberately **not** in that chain: it queries a live Postgres via `DATABASE_URL` and cannot run offline. Run it separately, against a migrated Postgres, when one is available:

```bash
pnpm --filter @wimm/api assert:constraints
```

This table adds no CHECK constraints, so it cannot regress that assertion; parity check 2 covers the SQLite side.

- [ ] **Step 2: Verify the packaged app still ships the local-only AI code**

```bash
pnpm --filter @wimm/desktop package
```

Expected: `after-pack` prints `assertLocalOnlyAiShipped: OK`. Then confirm at byte level:

```bash
node -e "const a=require('asar');console.log(a.listPackage(process.argv[1]).filter(p=>p.includes('/ai/local-only/')))" \
  "$(find apps/desktop/release -name app.asar | head -1)"
```

Expected: entries for every new `local-only` module. An empty list means the presence guard passed on emptiness — the exact vacuous-pass trap the inversion commit (`f5bcd73`) was written to close.

- [ ] **Step 3: Confirm the tree is clean and the node ABI is restored**

```bash
git status --porcelain && pnpm --filter @wimm/api exec tsx ../../scripts/select-native-abi.ts node
```

- [ ] **Step 4: Commit any verification fixes**

```bash
git add apps/api apps/desktop && git commit -m "test(ai): close out ChatGPT plan-usage verification"
```

---

## Before the first release — a blocking prerequisite, not a deferral

**Confirmed with the owner on 2026-10-04: no `v*` release has ever been cut.** That is what makes Task 1's approach valid, and it is the only thing that makes it valid.

The SQLite chain is a single `0000_baseline/migration.sql` that parity check 3 requires be a full regeneration, so a schema change rewrites it rather than adding an incremental migration. But `apps/api/src/prisma/local/migration-runner.ts` hard-fails at boot when an already-applied migration's checksum no longer matches its file. Consequences, in order of when they bite:

1. **Already true, today.** Any local profile database that applied an older baseline now refuses to boot. Commit `5581938` (CsvSourceMapping) already had this effect, so Task 1 is the second occurrence, not the first. Development profiles must be recreated after a schema change; that is the accepted cost of the pre-release window.
2. **Blocking, before the first `v*` tag.** `release-desktop.yml` triggers on `v*`, and `electron-updater` is wired to GitHub releases, so users *will* update with data on disk. The 2026-07-28 embedded-local-runtime design states it plainly: a regenerated baseline "works only until the first schema change ships, and then it either wipes or breaks the database of everyone who already uses the app."

**So before any release ships, the SQLite chain must move to incremental migrations** — freeze `0000_baseline`, author `0001_` onward for both dialects, and change parity check 3 to compare the *sum* of the chain against a regeneration rather than the baseline file alone. That is its own piece of work, outside this plan, and it must land before the first tag rather than after.

## Deferred, deliberately

- **Mobile.** `apps/mobile` is out of scope for this plan by constraint.
- **Jev.** A separate front for deterministic low-cost categorization, not part of this work.
