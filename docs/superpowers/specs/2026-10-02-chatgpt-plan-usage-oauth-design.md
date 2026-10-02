# ChatGPT Plan Usage — OAuth Flow Design

Written 2026-10-02. Design only; the task-by-task plan follows once the shape is approved.

**Goal:** a WIMM user connects their own ChatGPT account and categorization draws on their own Plus/Pro allowance — no API key to paste, no per-token cost, and no secret of theirs ever reaching the renderer or an exported profile.

**Eligibility, and why this build:** OpenAI offers ChatGPT plan usage to "open-source projects, personal projects that run locally, and selected private apps"; a paid or remotely hosted app must join a waitlist. The public desktop build is free, open-source and runs on the user's own machine, so it is the eligible one. The owner's VPS instance is not, which is the boundary `apps/api/scripts/verify-ai-hosted-composition.ts` now enforces.

## Mechanics confirmed from OpenAI's own documentation

Not assumed — read from the open-source cookbook article and the quickstart:

- **No pre-registration.** The flow sends `client_id=dynamic_agent_client` with an `agent_name_hint`; OpenAI registers the client during the flow. **No client secret and no API key are issued or needed.** This removes the "request a client ID and wait for approval" step that earlier notes in this project assumed was blocking.
- **Loopback callback.** The documented pattern starts a callback listener on `127.0.0.1` and passes that listener's own `redirect_uri` into the exchange. A dynamic port is the expected shape, not a problem to work around.
- **PKCE, `state` and `nonce`** are all part of the flow; the token exchange carries `code_verifier`.
- **Scopes** include identity scopes, `offline_access` (so refresh tokens are issued) and resource access for `chatgpt.tokens.use.direct`. The exchange sets `resource` to `https://api.openai.com/v1`.
- The response carries an `id_token` for verification, and the resulting session carries a **`sharing` flag** indicating whether that account's plan actually grants plan access.
- Requests then go to the **Responses API** with that profile's OAuth access token, refreshed when needed.

## The flow

```
renderer                 main (Electron)              system browser         OpenAI
   |                           |                            |                  |
   |-- "connect ChatGPT" ----->|                            |                  |
   |   (IPC, no secrets)       |                            |                  |
   |                           | generate code_verifier,    |                  |
   |                           | state, nonce; open a       |                  |
   |                           | loopback listener on       |                  |
   |                           | 127.0.0.1:<ephemeral>      |                  |
   |                           |                            |                  |
   |                           |-- shell.openExternal ----->|                  |
   |                           |   (authorize URL with      |-- authorize ---->|
   |                           |    code_challenge, state,  |                  |
   |                           |    nonce, redirect_uri)    |<- user consents -|
   |                           |                            |                  |
   |                           |<--- GET /callback?code&state ------------------|
   |                           |     (listener closes immediately)             |
   |                           |                                               |
   |                           | verify state; exchange code + code_verifier -->|
   |                           |<-- access_token, refresh_token, id_token ------|
   |                           | verify nonce in id_token; read `sharing`       |
   |                           |                                               |
   |                           | encrypt tokens with the profile secret        |
   |                           | and persist them in the profile database      |
   |                           |                                               |
   |<-- status: connected -----|                                               |
   |    (no token, ever)       |                                               |
```

## Decisions, and the reasoning that forces each one

### 1. The system browser, never an embedded window

`shell.openExternal`, not a `BrowserWindow`. Three independent reasons:

- An in-app OAuth window lets the application observe the user's OpenAI credentials as they type them. That is the classic anti-pattern RFC 8252 exists to stop.
- The user can read the real URL bar in their own browser and verify who is asking.
- WIMM's own hardening already forbids the alternative: CSP is `default-src 'self'`, `will-navigate` is denied for anything cross-origin, and `setWindowOpenHandler` denies outright. Those were added by the Phase 4b security review and must not be relaxed for this.

### 2. A dedicated loopback listener, separate from the API's port

The embedded API listens on its own ephemeral loopback port. **The callback must not land there.** Main opens a second, short-lived listener used only for this handshake: opened on "connect", closed the moment a code arrives or the attempt times out.

Bind `127.0.0.1` explicitly, never `0.0.0.0` — the same rule the API follows, and which has a test that connects from a non-loopback address and asserts refusal. That test's technique applies here unchanged.

### 3. PKCE, `state` and `nonce` — generated *and verified*

Without a client secret, the authorization code is the only thing standing between an interceptor and a token. PKCE is what proves possession.

A flow that generates these values and never checks them on return is theatre, and theatre that looks like security is the single most expensive defect class this project has produced. So the tests must prove **rejection**: a mismatched `state`, a mismatched `nonce` in the `id_token`, and a `code_verifier` that does not match the challenge must each abort the flow, and each must have a mutation proof showing the check fires.

### 4. The token never reaches the renderer

Same invariant as the per-launch session token, and for the same reason: the renderer is the untrusted side. It sends "connect" and receives a status — `connected`, `not connected`, `plan not eligible`, `expired`. Never a token, never a refresh token.

The IPC bridge already validates path, method and headers in main and asserts the resolved origin is the API's own. Nothing in this feature may add a renderer-reachable path to OpenAI.

### 5. Tokens encrypted with the existing per-profile secret

Phase 4c Task 1 put each profile's encryption secret at `<profileDir>/secrets/<id>.key` — a sibling of `profiles/`, deliberately **outside anything export copies**. I verified at the byte level that the secret appears nowhere in the `.db`.

That property is exactly what this feature needs: **an exported profile cannot use the tokens.** You export your financial history; you do not export your OpenAI session. Reuse `AiKeyCrypto` (`encrypt`/`decrypt`) rather than inventing a second mechanism.

`safeStorage` was considered and rejected for the same two reasons as in Task 1: `apps/api` must stay Electron-free, and it degrades on Linux without a keyring.

**This is worth stating plainly because it inverts an easy assumption:** plan usage does not make the per-profile secret work obsolete. It replaces "store the user's API key" with "store the user's OAuth tokens" — still a secret at rest, and one that grants access to a paid subscription. The work is reinforced, not retired.

### 6. Storage shape, and the cost it carries

Tokens are not the shape of `aiApiKeyEncrypted` (a single string): there is an access token, a refresh token, and an expiry. That needs new nullable columns or a small table.

That touches the schema, which means **both migration chains** plus the derived SQLite baseline and the CHECK-constraint list, all guarded by `assert:parity` and `assert:constraints` in CI. The hosted chain gets columns it will never populate; that is harmless and keeps the two chains identical, which is what parity requires.

Choose the migration timestamp after checking the highest existing one. This repository already contains one migration that can never run because its timestamp sorts before the migration that creates what it modifies; a second would be unforced.

### 7. Refresh is owned by the API, single-flight

The provider runs inside the embedded Nest API and needs a valid access token at categorize time. It reads the encrypted tokens and decrypts them with the profile secret `AppLocalModule.forRoot` already receives — mirroring how `AiKeyResolverService` resolves a BYOK key today.

Refresh must be **single-flight**: several categorize requests in one import batch must not each refresh and race each other into writing different token pairs. The desktop renderer already has a single-flight-with-queue interceptor for its own JWT; that is the pattern to follow, not a new one.

### 8. The contract widening — a real decision with a real cost

`AiProvider.categorizeBatch` currently takes `{ apiKey, transactions, candidates }`. Plan usage has no API key, and the stub's own doc comment already flags this.

**Proposal:** drop `apiKey` from the contract entirely and let each provider resolve its own credential. A provider knows how its own authentication works; the caller should not. The signature becomes `{ transactions, candidates }`.

**The cost, stated rather than buried:** this changes the Anthropic path's signature, so its existing specs change too. Every refactor in Stages 2 and 3 was held to "existing specs pass untouched" as the proof it was a refactor and not a rewrite. This one cannot meet that bar, and pretending otherwise would be worse than admitting it. The alternative — a discriminated credential union passed in — keeps the old tests but leaves a provider-specific parameter in a provider-agnostic contract. I recommend the clean change and the honest test churn.

## Failure modes, and what the user must see

These are not hypothetical; each one has a distinct cause and deserves a distinct message. Collapsing them into "AI unavailable" is the kind of conflation this project has already fixed three times elsewhere.

| Cause | What the user must be told |
|---|---|
| Never connected | An invitation to connect, not an error |
| Connected, but `sharing` is false | Their plan does not include plan usage — not a WIMM failure, and not something retrying fixes |
| Weekly per-app cap reached | OpenAI lets users cap each app; this is theirs to raise, and the message must say so |
| Access revoked at OpenAI | Reconnect; degrade to AI off meanwhile |
| Tokens undecryptable (exported profile) | Reconnect on this machine — expected, by design |
| Offline | AI unavailable; **the app stays fully usable.** WIMM is offline-first and categorization is an enhancement, never a gate |

`AiKeyResolverService` already treats a decrypt failure as "no key" rather than crashing, so there is precedent for degrading rather than failing.

Every user-facing string needs `en` and `pt`.

## What must never happen

- The access or refresh token in the renderer, in a log, in an error message, or in a crash report. The session-token work has a test asserting a response never contains the token value; the same shape applies here.
- An embedded `BrowserWindow` for the authorization page.
- Any relaxation of `contextIsolation`, `nodeIntegration: false`, `sandbox: true`, the CSP, the navigation denials, or the IPC bridge's main-side validation.
- The plan-usage provider reachable from `app.module.ts`. That is a licensing boundary now, and it is enforced at build level.

## The SDK question — investigated and settled

OpenAI ships an official DevKit (`openai/sign-in-with-chatgpt-devkit`): `@siwc/local` for the Node process and `@siwc/react` for UI. Its real advantages are not in doubt — OAuth, credential storage, account profiles, model discovery, streaming responses and token refresh, maintained by the one party that can change the protocol underneath us.

**It is nonetheless disqualified for this project, by its licence.**

The DevKit is released under the "Sign-in with ChatGPT DevKit Noncommercial License v1.0". It is not OSI-approved. It permits use "solely for Noncommercial Purposes", states that "Commercial use of OpenAI's Contribution requires a separate written agreement with OpenAI", and excludes from "Noncommercial Purpose" any "development, testing, distribution, or operation of a product or service by or for a business, employer, or client in connection with its operations or commercial advantage". Modifications must stay under the same licence.

WIMM ships under **MIT** (`LICENSE`, 2026, Anderson Rocha). MIT grants commercial use explicitly. Depending on a noncommercially-licensed package inside an MIT-licensed distributable is a contradiction in the artifact: the LICENSE file would promise more than the shipped application can deliver, and anyone taking WIMM at its word and running it at work would breach OpenAI's terms without being told. That is a licensing defect in a public release, not an engineering preference.

A second conflict, independent of the licence: the DevKit uses "OS-encrypted credential storage", which is per machine-user. WIMM's identity model is per *profile* — the whole subject of Phase 4c. Two profiles on one machine would share a single ChatGPT connection, and it reintroduces the Linux-without-a-keyring degradation that was one of the two reasons `safeStorage` was rejected in Task 1. Whether that storage layer is injectable could not be determined from the README (it defers to `docs/security.md`); the licence settles the question regardless.

Community alternatives exist (`openai-oauth`, `login-with-chatgpt`) and may be permissively licensed, but putting a third party's OAuth implementation on this feature's security-critical path is a worse trade than owning a few hundred tested lines — and it would need auditing anyway.

**Decision: implement the flow directly.** No new dependency.

If the owner later wants the DevKit regardless, the honest routes are to relicense WIMM or to publish with a prominent notice that the AI feature carries a noncommercial dependency. Both cost the clean "MIT, use it however you like" story, so the choice should be deliberate rather than discovered.
