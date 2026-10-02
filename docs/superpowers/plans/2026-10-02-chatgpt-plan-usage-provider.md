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
- Do not add attribution lines to commit messages.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/prisma/schema.prisma` | `ChatGptConnection` model (modify) |
| `apps/api/prisma/migrations/20261002120000_add_chatgpt_connection/migration.sql` | Postgres chain |
| `apps/api/prisma/migrations-sqlite/0000_baseline/migration.sql` | regenerated SQLite baseline |
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
| `apps/api/src/ai/local-only/chatgpt.controller.ts` | connect / status / disconnect |
| `apps/api/src/ai/local-only/local-only-ai.module.ts` | wire the above (modify) |
| `apps/desktop/src/main/chatgpt-browser.ts` | `openBrowser` via `shell.openExternal` |
| `apps/desktop/src/renderer/.../ChatGptConnection.tsx` | connect UI + failure messages |

---

## Task 1: `ChatGptConnection` schema and both migration chains

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261002120000_add_chatgpt_connection/migration.sql`
- Modify: `apps/api/prisma/migrations-sqlite/0000_baseline/migration.sql`

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
  id               String   @id @default(cuid())
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

- [ ] **Step 4: Regenerate the SQLite baseline and assert parity**

```bash
pnpm --filter @wimm/api assert:parity && pnpm --filter @wimm/api assert:constraints
```

Expected: both exit 0. If `assert:parity` reports the SQLite baseline is missing the table, add the equivalent `CREATE TABLE`/`CREATE UNIQUE INDEX` to `migrations-sqlite/0000_baseline/migration.sql` (SQLite types: `TEXT`, `INTEGER NOT NULL DEFAULT 0` for the boolean, `DATETIME`) and re-run until both pass.

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
    if (typeof document[key] !== 'string' || !document[key]) {
      throw new Error(`ChatGPT OIDC discovery is missing ${key}.`)
    }
  }
  return document as unknown as OidcConfig
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @wimm/api test -- chatgpt-oidc
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai/local-only
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
    expect(a.verifier.length).toBeGreaterThanOrEqual(43)
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
  const url = new URL(args.config.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', args.existingClientId ?? DYNAMIC_CLIENT_ID)
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
  if (!args.existingClientId) {
    url.searchParams.set('agent_name_hint', args.appName)
  }
  return { url: url.toString(), verifier, state, nonce }
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @wimm/api test -- chatgpt-authorize
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai/local-only
git commit -m "feat(ai): build the ChatGPT authorize request with PKCE"
```

---

## Task 5: The loopback callback listener

**Files:**
- Create: `apps/api/src/ai/local-only/chatgpt-callback-listener.ts`
- Test: `apps/api/src/ai/local-only/chatgpt-callback-listener.spec.ts`

**Interfaces:**
- Consumes: `CHATGPT_CALLBACK_PATH`, `DYNAMIC_CLIENT_ID` (Task 3)
- Produces: `startCallbackListener(args: { expectedState: string; timeoutMs?: number }): Promise<{ redirectUri: string; result: Promise<{ code: string; clientId: string }>; close(): void }>`

**Security surface:** this binds a real socket and receives attacker-reachable input. It must bind `127.0.0.1` only, accept exactly the callback path, require a single `code`, require `state` to match, reject a `client_id` equal to `dynamic_agent_client` or failing `^[a-zA-Z0-9_-]{1,200}$`, and close on the first request.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/ai/local-only/chatgpt-callback-listener.spec.ts
import { startCallbackListener } from './chatgpt-callback-listener'

const hit = async (redirectUri: string, query: string) => {
  const url = new URL(redirectUri)
  await fetch(`${url.origin}${url.pathname}?${query}`).catch(() => undefined)
}

describe('startCallbackListener', () => {
  it('binds loopback only and resolves on a valid callback', async () => {
    const listener = await startCallbackListener({ expectedState: 's-1' })
    expect(new URL(listener.redirectUri).hostname).toBe('127.0.0.1')
    expect(new URL(listener.redirectUri).pathname).toBe('/auth/callback')
    await hit(listener.redirectUri, 'code=c-1&state=s-1&client_id=abc123')
    await expect(listener.result).resolves.toEqual({ code: 'c-1', clientId: 'abc123' })
  })

  it('rejects a state mismatch', async () => {
    const listener = await startCallbackListener({ expectedState: 's-1' })
    await hit(listener.redirectUri, 'code=c-1&state=WRONG&client_id=abc123')
    await expect(listener.result).rejects.toThrow(/state/i)
  })

  it('rejects the dynamic placeholder as a returned client id', async () => {
    const listener = await startCallbackListener({ expectedState: 's-1' })
    await hit(listener.redirectUri, 'code=c-1&state=s-1&client_id=dynamic_agent_client')
    await expect(listener.result).rejects.toThrow(/client_id/i)
  })

  it('rejects a duplicated code parameter', async () => {
    const listener = await startCallbackListener({ expectedState: 's-1' })
    await hit(listener.redirectUri, 'code=a&code=b&state=s-1&client_id=abc123')
    await expect(listener.result).rejects.toThrow(/code/i)
  })

  it('rejects a request to any other path', async () => {
    const listener = await startCallbackListener({ expectedState: 's-1' })
    const origin = new URL(listener.redirectUri).origin
    await fetch(`${origin}/not-the-callback?code=c&state=s-1&client_id=abc123`).catch(
      () => undefined,
    )
    await expect(listener.result).rejects.toThrow()
  })

  it('rejects on timeout and frees the port', async () => {
    const listener = await startCallbackListener({ expectedState: 's-1', timeoutMs: 50 })
    await expect(listener.result).rejects.toThrow(/timed out/i)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @wimm/api test -- chatgpt-callback-listener
```

Expected: FAIL, cannot resolve the module.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/ai/local-only/chatgpt-callback-listener.ts
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CHATGPT_CALLBACK_PATH, DYNAMIC_CLIENT_ID } from './chatgpt-oidc'

const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,200}$/
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export interface CallbackListener {
  redirectUri: string
  result: Promise<{ code: string; clientId: string }>
  close(): void
}

/**
 * A single-use loopback listener for the OAuth redirect.
 *
 * Binds 127.0.0.1 on an ephemeral port -- deliberately not the API's own
 * port, so nothing about the authorization flow depends on where the API
 * happens to be listening. The first request on the callback path settles
 * the result and the server closes; everything else is rejected.
 */
export async function startCallbackListener(args: {
  expectedState: string
  timeoutMs?: number
}): Promise<CallbackListener> {
  let settle: (value: { code: string; clientId: string }) => void
  let fail: (error: Error) => void
  const result = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
    settle = resolve
    fail = reject
  })

  const server = createServer((request, response) => {
    const respond = (status: number, body: string) => {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(body)
      close()
    }
    let url: URL
    try {
      url = new URL(request.url ?? '/', 'http://127.0.0.1')
    } catch {
      fail(new Error('ChatGPT callback received an unparseable request.'))
      return respond(400, 'Bad request')
    }
    if (url.pathname !== CHATGPT_CALLBACK_PATH) {
      fail(new Error(`ChatGPT callback received an unexpected path: ${url.pathname}`))
      return respond(404, 'Not found')
    }
    const codes = url.searchParams.getAll('code')
    const clientIds = url.searchParams.getAll('client_id')
    const state = url.searchParams.get('state')
    const code = codes[0]
    const clientId = clientIds[0]
    if (codes.length !== 1 || !code) {
      fail(new Error('ChatGPT callback did not carry exactly one code.'))
      return respond(400, 'Bad request')
    }
    if (state !== args.expectedState) {
      fail(new Error('ChatGPT callback state did not match the request.'))
      return respond(400, 'Bad request')
    }
    if (
      clientIds.length !== 1 ||
      !clientId ||
      clientId === DYNAMIC_CLIENT_ID ||
      !CLIENT_ID_PATTERN.test(clientId)
    ) {
      fail(new Error('ChatGPT callback returned an unusable client_id.'))
      return respond(400, 'Bad request')
    }
    settle({ code, clientId })
    respond(200, 'WIMM is connected. You can close this tab.')
  })

  const timer = setTimeout(() => {
    fail(new Error('ChatGPT authorization timed out.'))
    close()
  }, args.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  timer.unref?.()

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    server.close()
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  // Never surface a rejection as an unhandled promise if no one awaits it.
  result.catch(() => undefined)

  return {
    redirectUri: `http://127.0.0.1:${address.port}${CHATGPT_CALLBACK_PATH}`,
    result,
    close,
  }
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @wimm/api test -- chatgpt-callback-listener
```

Expected: 6 passing.

- [ ] **Step 5: Prove the loopback bind is real, not a string (mutation check)**

Temporarily change `server.listen(0, '127.0.0.1', resolve)` to `server.listen(0, '0.0.0.0', resolve)` and re-run. The suite still passes — which is the point: a hostname assertion on `redirectUri` proves nothing about the bind. Add this assertion so it does, then revert the mutation:

```ts
it('binds only the loopback interface, not every interface', async () => {
  const listener = await startCallbackListener({ expectedState: 's-1' })
  const port = Number(new URL(listener.redirectUri).port)
  const { createConnection } = await import('node:net')
  const reachableExternally = await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '0.0.0.0', port })
    socket.on('connect', () => { socket.destroy(); resolve(true) })
    socket.on('error', () => resolve(false))
  })
  listener.close()
  expect(reachableExternally).toBe(false)
})
```

Re-run with the mutation in place: this new test must FAIL. Revert to `'127.0.0.1'`: it must PASS. `apps/desktop/src/main/local-api.ts` has `assertBoundToLoopback` for the same reason — its doc comment records that asserting on the *string passed to* `listen()` proves nothing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai/local-only
git commit -m "feat(ai): add the single-use loopback callback listener"
```

---

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
const jwk = { ...createPublicKey(publicKey).export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }
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

Write `chatgpt-token-exchange.ts` with:
- `fetchJwk(jwksUri, kid, fetchImpl)` — fetch the key set, pick the entry whose `kid` matches the token header, and build a key with `createPublicKey({ key: jwk, format: 'jwk' })`. Cache per `jwksUri`, and **drop the cache entry on a verification failure** so a rotated key is re-fetched once rather than failing until restart.
- `verifyIdentity(...)` — decode the header for `kid`, verify with `new JwtService().verifyAsync(idToken, { publicKey, algorithms: ['RS256'], issuer, audience: clientId })`, then compare the `nonce` claim and throw if it differs. Read `sharing` from the claim, defaulting to `false` when absent.
- `exchangeCode(...)` — POST `application/x-www-form-urlencoded` to `config.token_endpoint` with `grant_type=authorization_code`, `client_id`, `code`, `code_verifier`, `redirect_uri`, `resource`. Require `access_token`; require `refresh_token` when the granted scopes include `offline_access`; compute `expiresAt` from `expires_in`; then call `verifyIdentity` before returning.

**Error messages must never interpolate a token, a code, or a verifier.** Include the status and the field that was missing, nothing else.

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @wimm/api test -- chatgpt-token-exchange
```

Expected: 5 passing.

- [ ] **Step 5: Assert no secret can leak through an error**

Add a test that drives `exchangeCode` into each failure branch and asserts the thrown message contains neither the access token, the refresh token, the code, nor the verifier:

```ts
it('never puts a credential in an error message', async () => {
  const secrets = ['at', 'rt', 'the-code', 'the-verifier']
  await exchangeCode({
    config, clientId: 'client-1', code: 'the-code', verifier: 'the-verifier',
    redirectUri: 'http://127.0.0.1:1/auth/callback', nonce: 'n-1',
    fetchImpl: fetchStub({ access_token: 'at', refresh_token: 'rt', id_token: signIdToken({ nonce: 'X' }), expires_in: 1, scope: 'offline_access' }),
  }).catch((error: Error) => {
    for (const secret of secrets) expect(error.message).not.toContain(secret)
  })
})
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai/local-only
git commit -m "feat(ai): exchange the ChatGPT code and verify the id_token"
```

---

## Task 7: The encrypted connection store

**Files:**
- Create: `apps/api/src/ai/local-only/chatgpt-connection.store.ts`
- Test: `apps/api/src/ai/local-only/chatgpt-connection.store.spec.ts`

**Interfaces:**
- Consumes: `ChatGptCredentials` (Task 6), the `chatGptConnection` delegate (Task 1), `encryptWithAiKey`/`decryptWithAiKey` from `../ai-key-crypto`
- Produces: `ChatGptConnectionStore` with `load(userId)`, `save(userId, credentials)`, `savePending(userId, credentials)`, `promotePending(userId)`, `clearTokens(userId)`, `status(userId)`

**Requirements:**
- Tokens are encrypted with the per-profile secret, exactly as `AiKeyCrypto` already does for the BYOK key.
- `load` on an undecryptable row returns `null` rather than throwing — matching how `AiKeyResolverService` treats a decrypt failure as "no key", which is what makes an exported profile degrade instead of crash.
- `clearTokens` nulls `tokensEncrypted` and `pendingEncrypted` but **retains `clientId` and `accountLabel`**.
- `status` never returns a token — only `{ connected, sharing, accountLabel, expiresAt }`.

- [ ] **Step 1: Write the failing test** — cover: round-trip through encryption; ciphertext on disk is not the plaintext token; `load` returns `null` for a row encrypted under a different secret; `clearTokens` keeps `clientId`; `status` output contains no token substring; `promotePending` moves pending to current and clears pending.

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
git add apps/api/src/ai/local-only
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
- **A refresh response may omit `scope`.** Fall back to the stored scopes; do not treat the omission as a scope downgrade.
- **Pending rotation:** persist rotated credentials via `savePending` *before* verifying the new `id_token`; `promotePending` only after verification succeeds. If verification fails because the signing-key service is unavailable, leave the pending state in place and return a retryable error — a later call, including after a restart, resumes from it rather than replaying a consumed refresh token.

- [ ] **Step 1: Write the failing test** — cover: a valid token near expiry triggers exactly one network refresh for ten concurrent callers; a response omitting `scope` keeps the stored scopes; verification failure leaves `pendingEncrypted` populated and the old row intact; a second call after that failure resumes from pending without a second refresh grant; a revoked refresh token clears tokens and returns `null`.

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
git add apps/api/src/ai/local-only
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
git add apps/api/src/ai/local-only
git commit -m "feat(ai): implement the ChatGPT plan-usage provider"
```

---

## Task 10: Connect / status / disconnect routes

**Files:**
- Create: `apps/api/src/ai/local-only/chatgpt.controller.ts`
- Modify: `apps/api/src/ai/local-only/local-only-ai.module.ts`
- Test: `apps/api/src/ai/local-only/chatgpt.controller.spec.ts`
- Verify: `apps/api/src/profile/local-route-posture.spec.ts` picks the new routes up automatically

**Interfaces:**
- Produces: `POST /api/ai/chatgpt/connect`, `GET /api/ai/chatgpt/status`, `POST /api/ai/chatgpt/disconnect`

**Requirements:**
- `connect` runs discovery, starts the listener, calls the injected `openBrowser`, awaits the callback, exchanges, stores, and returns **status only**.
- `status` returns `{ connected, sharing, accountLabel, expiresAt }` — never a token.
- Validate every input with `class-validator`; keep controllers thin with the logic in the services from Tasks 3-8.
- The existing `SessionTokenGuard` posture must cover these routes; `local-route-posture.spec.ts` walks the real Express stack, so any route added to `AppLocalModule` is covered automatically.

- [ ] **Step 1: Write the failing test** — assert the status payload has no `accessToken`/`refreshToken`/`idToken` key at any depth, and that `disconnect` leaves `status.connected === false` while a subsequent `connect` reuses the stored `clientId`.

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
- Modify: `apps/api/src/app.local.module.ts` (accept `openBrowser` in `AppLocalModuleOptions`)
- Test: `apps/desktop/src/main/chatgpt-browser.spec.ts`

**Interfaces:**
- Produces: `openChatGptAuthorizeUrl(url: string): Promise<void>`
- Consumes: `AppLocalModuleOptions` gains `openBrowser: (url: string) => Promise<void>`

**Requirements:**
- `shell.openExternal` only. **No `BrowserWindow`.**
- Refuse any URL whose origin is not the discovered issuer's origin. An `openExternal` that forwards an arbitrary string is a navigation primitive handed to whatever can reach it.
- `AppLocalModule.forRoot` must follow the existing assert-then-refuse contract: refuse to compose when `openBrowser` is missing, the same way `assertUsableSessionToken` and `assertUsableAiKeyEncryptionSecret` already do, so a misconfiguration is a boot failure that names itself.

- [ ] **Step 1: Write the failing test** — assert `shell.openExternal` is called for an `https://auth.openai.com/...` URL, that a `file://`, `javascript:` or other-origin URL is refused without calling it, and that `BrowserWindow` is never constructed.

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

## Task 12: Renderer UI and every failure message in `en` + `pt`

**Files:**
- Create: `apps/desktop/src/renderer/components/settings/ChatGptConnection.tsx`
- Modify: the settings screen that hosts AI preferences
- Modify: the `i18next` resource files for `en` and `pt`
- Test: `apps/desktop/src/renderer/.../ChatGptConnection.spec.tsx`

**Requirements:**
- React Query for the status call; the single shared `axios` instance — do not add a second.
- Components from `renderer/components/ui/`; tokens only from `renderer/styles/theme.css`. No hardcoded colours.
- One distinct message per row of the design's failure table: never connected (an invitation, not an error), `sharing` false, weekly per-app cap reached, access revoked, tokens undecryptable on this machine, offline. Collapsing these into "AI unavailable" is the conflation this project has already fixed three times elsewhere.
- **The renderer must never receive a token.** Assert it.

- [ ] **Step 1: Write the failing test** — render each failure state and assert a distinct message; assert no response payload the component receives contains a token key.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @wimm/desktop test -- ChatGptConnection
```

- [ ] **Step 3: Implement** the component and add both locales.

- [ ] **Step 4: Assert locale parity**

```bash
pnpm --filter @wimm/desktop test -- ChatGptConnection && pnpm --filter @wimm/desktop lint
```

Every key added to `en` must exist in `pt`. If the repo has no parity test for locales, add one in this task asserting the two key sets are identical.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(desktop): add the ChatGPT connection UI with en and pt strings"
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
 && pnpm --filter @wimm/api assert:constraints \
 && pnpm --filter @wimm/api verify:ai-hosted-composition \
 && pnpm lint \
 && pnpm build
```

Expected: all green. Baselines before this plan: api 67 suites / 596 tests, desktop 8 / 111, shared 34, scripts 14, route posture 7, parity 3/3, build 3/3, lint 6/6.

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
git add -A && git commit -m "test(ai): close out ChatGPT plan-usage verification"
```

---

## Deferred, deliberately

- **Mobile.** `apps/mobile` is out of scope for this plan by constraint.
- **Jev.** A separate front for deterministic low-cost categorization, not part of this work.
