import { createServer, type ServerResponse } from 'node:http'
import { CHATGPT_CALLBACK_PATH, DYNAMIC_CLIENT_ID } from './chatgpt-oidc'

/**
 * The single-use loopback receiver for the OAuth redirect.
 *
 * **Two phases, because the port and the state each need the other's output.**
 * `createAuthorizeRequest` takes `redirectUri` as input and is the only
 * producer of `state`; the port in `redirectUri` exists only once a socket is
 * bound. So binding (`startCallbackListener`) comes first and hands back the
 * `redirectUri`, then the caller builds the authorize request and arms the
 * listener with the resulting `state` (`awaitCallback`). Do not fold these
 * back into one call that takes `expectedState` up front: that is a cycle
 * neither side can enter.
 *
 * **Ordering is not the caller's problem.** The first request is held until
 * the listener is armed, and the first arm is held until a request arrives;
 * the callback is judged once both are present. A browser that wins the race
 * against `awaitCallback` is therefore not a failure.
 *
 * **This is a socket that attacker-reachable input arrives on.** Any local
 * process, and any web page via DNS rebinding, can send it a request. It
 * therefore:
 *
 * - binds `127.0.0.1` only, and checks the address the OS actually bound
 *   rather than trusting the host it asked for;
 * - serves exactly `CHATGPT_CALLBACK_PATH` over GET and nothing else;
 * - requires exactly one `code`, exactly one `state` equal to the armed
 *   value, and exactly one `client_id` that is well-formed and is not the
 *   `dynamic_agent_client` placeholder (a repeated parameter is an
 *   ambiguity, never "take the first");
 * - closes on the first request, valid or not. One request is all a genuine
 *   redirect ever sends, so a forged one that fails validation ends the
 *   attempt instead of leaving the socket open to be tried again.
 *   `state` is therefore compared with `===`: the attacker gets a single
 *   guess, so there is no timing signal to average over.
 *
 * **No error message contains a submitted value.** `code` is a bearer
 * credential, `state` is the CSRF secret, and the path and `client_id` are
 * attacker-chosen text that would end up in logs. Messages name the field
 * that was wrong, never what it held. Keep it that way when adding checks.
 *
 * The browser is answered with the same static page whether or not the
 * callback validates: the verdict goes to the caller, not to whoever sent
 * the request.
 */

const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,200}$/
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const LOOPBACK_HOST = '127.0.0.1'

export interface CallbackResult {
  code: string
  clientId: string
}

export interface CallbackListener {
  /** `http://127.0.0.1:<bound port>/auth/callback` — known only after binding. */
  redirectUri: string
  /**
   * Arm the listener with the state to require. Call at most once; a second
   * call throws synchronously. The returned promise is the same one the
   * listener settles, so it is not a subscription.
   */
  awaitCallback(expectedState: string): Promise<CallbackResult>
  /** Frees the port and fails a pending wait. Idempotent. */
  close(): void
}

/**
 * The first thing that ends the attempt. A failure is final on its own; a
 * callback still has to be judged against the armed state.
 */
type Arrival =
  | { kind: 'failure'; error: Error }
  | { kind: 'callback'; query: URLSearchParams }

const DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>WIMM</title>' +
  '<p>You can close this tab and return to WIMM.</p>' +
  '<p>Você pode fechar esta aba e voltar ao WIMM.</p>'

function respond(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    // The page has no resources and nothing links out of it, but the request
    // URL carried a credential, so be explicit that none of it travels on.
    'Content-Security-Policy': "default-src 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    // A single-use listener has no use for a kept-alive connection.
    Connection: 'close',
  })
  res.end(body)
}

/**
 * Judges a received callback against the armed state. Throws an `Error` that
 * names the offending field and never its value.
 */
function validateCallback(
  query: URLSearchParams,
  expectedState: string,
): CallbackResult {
  const states = query.getAll('state')
  // An empty state never matches, so an armed '' cannot be satisfied by `state=`.
  if (states.length !== 1 || states[0] === '' || states[0] !== expectedState) {
    throw new Error(
      'ChatGPT sign-in callback state is missing or does not match.',
    )
  }

  const codes = query.getAll('code')
  if (codes.length !== 1 || codes[0] === '') {
    throw new Error(
      'ChatGPT sign-in callback must carry exactly one non-empty code.',
    )
  }

  const clientIds = query.getAll('client_id')
  if (clientIds.length !== 1 || !CLIENT_ID_PATTERN.test(clientIds[0])) {
    throw new Error(
      'ChatGPT sign-in callback must carry exactly one well-formed client_id.',
    )
  }
  if (clientIds[0] === DYNAMIC_CLIENT_ID) {
    throw new Error(
      'ChatGPT sign-in callback client_id is the unregistered placeholder.',
    )
  }

  return { code: codes[0], clientId: clientIds[0] }
}

export async function startCallbackListener(
  args: { timeoutMs?: number } = {},
): Promise<CallbackListener> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const server = createServer()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })

  // Trust the OS, not the argument above. The same check, for the same
  // reason, as `assertBoundToLoopback` in apps/desktop/src/main/local-api.ts.
  const address = server.address()
  if (
    address === null ||
    typeof address === 'string' ||
    address.address !== LOOPBACK_HOST
  ) {
    server.close()
    throw new Error(
      'ChatGPT sign-in callback listener refused to continue: it is not bound to 127.0.0.1.',
    )
  }
  const redirectUri = `http://${LOOPBACK_HOST}:${address.port}${CHATGPT_CALLBACK_PATH}`

  let resolveResult!: (result: CallbackResult) => void
  let rejectResult!: (error: unknown) => void
  const result = new Promise<CallbackResult>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  // The caller may never await this (it fails on a timeout before arming, or
  // the caller closes the listener and walks away). Without a handler that is
  // an unhandled rejection, which kills the process or fails whichever
  // unrelated test happens to be running. A caller that does await it still
  // sees the rejection: this only registers a second, silent handler.
  result.catch(() => undefined)

  // The two slots of the state machine, and the flag that makes it terminal.
  let armed: { state: string } | undefined
  let arrival: Arrival | undefined
  let settled = false

  /**
   * Starts at bind, not at arm: a listener that is bound and then never armed
   * must still free its port.
   */
  const timer = setTimeout(
    () =>
      abandon(
        new Error(
          'ChatGPT sign-in callback timed out waiting for the browser redirect.',
        ),
      ),
    timeoutMs,
  )

  /** Stops accepting connections and frees the port. Safe to repeat. */
  function release(): void {
    clearTimeout(timer)
    if (server.listening) server.close()
  }

  /** Records the first arrival, frees the port, and settles if it can. */
  function arrive(next: Arrival): void {
    if (arrival !== undefined) return
    arrival = next
    release()
    conclude()
  }

  /**
   * Ends the attempt with no request in flight, so nothing legitimate needs
   * the open connections to finish: drop them too. A no-op once something has
   * arrived, because that arrival already released the port and a response
   * may still be going out on it.
   */
  function abandon(error: Error): void {
    if (arrival !== undefined) return
    arrive({ kind: 'failure', error })
    server.closeAllConnections()
  }

  /** Settles once the slots hold what is needed; otherwise does nothing. */
  function conclude(): void {
    if (settled || arrival === undefined) return
    if (arrival.kind === 'failure') {
      settled = true
      rejectResult(arrival.error)
      return
    }
    if (armed === undefined) return
    settled = true
    try {
      resolveResult(validateCallback(arrival.query, armed.state))
    } catch (error) {
      rejectResult(error)
    }
  }

  server.on('request', (req, res) => {
    // A second connection accepted before the port closed. The first request
    // owns the attempt; never let a later one replace it.
    if (arrival !== undefined) {
      respond(res, 409, 'Already used.')
      return
    }

    const target = req.url ?? ''
    const queryStart = target.indexOf('?')
    // Raw, exact comparison: no URL normalisation that could make
    // `/x/../auth/callback`, `//auth/callback` or a different case look like
    // the callback.
    const path = queryStart === -1 ? target : target.slice(0, queryStart)

    // After the first response finishes, nothing else needs this server, so
    // drop whatever connections are still open rather than wait for them.
    res.once('close', () => server.closeAllConnections())

    if (path !== CHATGPT_CALLBACK_PATH) {
      respond(res, 404, 'Not found.')
      arrive({
        kind: 'failure',
        error: new Error(
          'ChatGPT sign-in callback was requested on an unexpected path.',
        ),
      })
      return
    }
    if (req.method !== 'GET') {
      respond(res, 405, 'Method not allowed.')
      arrive({
        kind: 'failure',
        error: new Error(
          'ChatGPT sign-in callback must be a GET request; got another method.',
        ),
      })
      return
    }

    respond(res, 200, DONE_PAGE)
    arrive({
      kind: 'callback',
      query: new URLSearchParams(
        queryStart === -1 ? '' : target.slice(queryStart + 1),
      ),
    })
  })

  // A server error after binding (for example running out of descriptors)
  // would otherwise be thrown as an uncaught exception.
  server.on('error', () =>
    abandon(new Error('ChatGPT sign-in callback listener failed.')),
  )

  return {
    redirectUri,
    awaitCallback(expectedState: string): Promise<CallbackResult> {
      if (armed !== undefined) {
        throw new Error('awaitCallback may be called only once.')
      }
      armed = { state: expectedState }
      conclude()
      return result
    },
    close(): void {
      abandon(
        new Error(
          'ChatGPT sign-in callback listener was closed before a callback arrived.',
        ),
      )
    },
  }
}
