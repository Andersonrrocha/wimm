import { createConnection, createServer } from 'node:net'
import { networkInterfaces } from 'node:os'
import {
  ChatGptSignInDeniedError,
  ChatGptSignInTimedOutError,
  startCallbackListener,
  type CallbackListener,
} from './chatgpt-callback-listener'
import { CHATGPT_CALLBACK_PATH, DYNAMIC_CLIENT_ID } from './chatgpt-oidc'

/**
 * Every listener a test starts is closed in `afterEach`, whether the test
 * passed, failed an assertion or threw. These tests bind real sockets: a
 * path that forgot to close would leak a port and keep Jest alive.
 * `close()` is idempotent, so closing one a test already closed is a no-op.
 */
const started: CallbackListener[] = []
const start = async (
  args?: Parameters<typeof startCallbackListener>[0],
): Promise<CallbackListener> => {
  const listener = await startCallbackListener(args)
  started.push(listener)
  return listener
}
afterEach(() => {
  for (const listener of started.splice(0)) listener.close()
})

/** Returns the HTTP status, or `undefined` if the connection failed. */
const hit = async (
  redirectUri: string,
  query: string,
  init?: RequestInit,
): Promise<number | undefined> => {
  const url = new URL(redirectUri)
  const response = await fetch(
    `${url.origin}${url.pathname}?${query}`,
    init,
  ).catch(() => undefined)
  return response?.status
}

const portOf = (redirectUri: string): number =>
  Number(new URL(redirectUri).port)

/** Resolves true if a TCP connection to `host:port` is accepted. */
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

/**
 * A non-loopback IPv4 address of this machine, if it has one.
 *
 * Probing `0.0.0.0` instead, as an earlier draft of this test did, proves
 * nothing: connecting to the unspecified address is routed to the local host,
 * so it succeeds against a server bound to `127.0.0.1` as readily as against
 * one bound to every interface. Only an address that is genuinely off the
 * loopback interface separates the two binds.
 */
const externalAddress = (): string | undefined =>
  Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .find((address) => address.family === 'IPv4' && !address.internal)?.address

const VALID = 'code=c-1&state=s-1&client_id=abc123'

describe('startCallbackListener', () => {
  it('binds loopback on the callback path and resolves a valid callback', async () => {
    const listener = await start()
    expect(new URL(listener.redirectUri).hostname).toBe('127.0.0.1')
    expect(new URL(listener.redirectUri).pathname).toBe(CHATGPT_CALLBACK_PATH)
    expect(CHATGPT_CALLBACK_PATH).toBe('/auth/callback')

    const pending = listener.awaitCallback('s-1')
    await hit(listener.redirectUri, VALID)

    await expect(pending).resolves.toEqual({ code: 'c-1', clientId: 'abc123' })
  })

  // Without a non-loopback interface (a network-less sandbox) the probe has
  // nothing to connect to, so the test is skipped by name rather than passing
  // vacuously.
  const loopbackOnly = externalAddress() ? it : it.skip
  loopbackOnly(
    'binds only the loopback interface, not every interface',
    async () => {
      const external = externalAddress() as string

      // Positive control: a wildcard-bound server must be reachable through
      // this exact probe. Without it a probe that can reach nothing would let
      // the assertion below pass for the wrong reason.
      const wildcard = createServer((socket) => socket.destroy())
      await new Promise<void>((resolve) =>
        wildcard.listen(0, '0.0.0.0', resolve),
      )
      const controlPort = (wildcard.address() as { port: number }).port
      const controlReachable = await accepts(external, controlPort)
      await new Promise((resolve) => wildcard.close(resolve))
      expect(controlReachable).toBe(true)

      const listener = await start()
      const port = portOf(listener.redirectUri)
      expect(await accepts('127.0.0.1', port)).toBe(true)
      expect(await accepts(external, port)).toBe(false)
    },
  )

  it('accepts a callback that arrives before it is armed', async () => {
    const listener = await start()
    // Deliberately the wrong order: the request lands first.
    await hit(listener.redirectUri, VALID)
    await expect(listener.awaitCallback('s-1')).resolves.toEqual({
      code: 'c-1',
      clientId: 'abc123',
    })
  })

  it('rejects a buffered callback whose state does not match the armed value', async () => {
    const listener = await start()
    await hit(listener.redirectUri, 'code=c-1&state=WRONG&client_id=abc123')
    await expect(listener.awaitCallback('s-1')).rejects.toThrow(/state/i)
  })

  it('rejects a buffered request to the wrong path once armed', async () => {
    const listener = await start()
    const origin = new URL(listener.redirectUri).origin
    await fetch(`${origin}/elsewhere?${VALID}`).catch(() => undefined)
    await expect(listener.awaitCallback('s-1')).rejects.toThrow(/path/i)
  })

  it.each([
    ['code=c-1&state=WRONG&client_id=abc123', /state/i],
    ['code=c-1&client_id=abc123', /state/i],
    ['code=c-1&state=&client_id=abc123', /state/i],
    // A duplicated state must not let the first copy through.
    ['code=c-1&state=s-1&state=WRONG&client_id=abc123', /state/i],
    ['code=c-1&state=WRONG&state=s-1&client_id=abc123', /state/i],
    [`code=c-1&state=s-1&client_id=${DYNAMIC_CLIENT_ID}`, /client_id/i],
    ['code=c-1&state=s-1&client_id=has%20space', /client_id/i],
    ['code=c-1&state=s-1&client_id=a.b', /client_id/i],
    ['code=c-1&state=s-1&client_id=', /client_id/i],
    [`code=c-1&state=s-1&client_id=${'a'.repeat(201)}`, /client_id/i],
    ['code=c-1&state=s-1&client_id=abc123&client_id=def456', /client_id/i],
    ['code=c-1&state=s-1', /client_id/i],
    ['code=a&code=b&state=s-1&client_id=abc123', /code/i],
    ['state=s-1&client_id=abc123', /code/i],
    ['code=&state=s-1&client_id=abc123', /code/i],
  ])('rejects the callback %p', async (query, expected) => {
    const listener = await start()
    const pending = listener.awaitCallback('s-1')
    await hit(listener.redirectUri, query)
    await expect(pending).rejects.toThrow(expected)
  })

  it('accepts a client id at the 200 character limit', async () => {
    const listener = await start()
    const pending = listener.awaitCallback('s-1')
    const clientId = `a-_${'Z9'.repeat(98)}0`
    expect(clientId).toHaveLength(200)
    await hit(listener.redirectUri, `code=c-1&state=s-1&client_id=${clientId}`)
    await expect(pending).resolves.toEqual({ code: 'c-1', clientId })
  })

  it('never accepts an empty armed state as matching an empty callback state', async () => {
    const listener = await start()
    const pending = listener.awaitCallback('')
    await hit(listener.redirectUri, 'code=c-1&state=&client_id=abc123')
    await expect(pending).rejects.toThrow(/state/i)
  })

  it('rejects a request to any other path and answers 404', async () => {
    const listener = await start()
    const pending = listener.awaitCallback('s-1')
    const origin = new URL(listener.redirectUri).origin
    const response = await fetch(
      `${origin}/not-the-callback?code=c&state=s-1&client_id=abc123`,
    ).catch(() => undefined)
    expect(response?.status).toBe(404)
    await expect(pending).rejects.toThrow(/path/i)
  })

  it.each([
    `${CHATGPT_CALLBACK_PATH}/`,
    '/AUTH/CALLBACK',
    `/x/..${CHATGPT_CALLBACK_PATH}`,
    `//${CHATGPT_CALLBACK_PATH.slice(1)}`,
  ])('treats %p as a different path from the callback', async (path) => {
    const listener = await start()
    const pending = listener.awaitCallback('s-1')
    const origin = new URL(listener.redirectUri).origin
    // `fetch` would normalise dot segments, so send the path verbatim.
    const status = await new Promise<number | undefined>((resolve) => {
      const socket = createConnection({
        host: '127.0.0.1',
        port: portOf(origin),
      })
      let raw = ''
      socket.on('connect', () =>
        socket.write(
          `GET ${path}?${VALID} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
        ),
      )
      socket.on('data', (chunk) => (raw += chunk.toString()))
      socket.on('close', () =>
        resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1]) || undefined),
      )
      socket.on('error', () => resolve(undefined))
    })
    expect(status).toBe(404)
    await expect(pending).rejects.toThrow(/path/i)
  })

  it('rejects a callback that is not a GET and answers 405', async () => {
    const listener = await start()
    const pending = listener.awaitCallback('s-1')
    expect(await hit(listener.redirectUri, VALID, { method: 'POST' })).toBe(405)
    await expect(pending).rejects.toThrow(/method/i)
  })

  it('sends Allow: GET with the 405, as RFC 9110 requires', async () => {
    const listener = await start()
    listener.awaitCallback('s-1').catch(() => undefined)
    const url = new URL(listener.redirectUri)
    const response = await fetch(`${url.origin}${url.pathname}?${VALID}`, {
      method: 'POST',
    })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'refuses to start with a timeoutMs of %p rather than silently firing at once',
    async (timeoutMs) => {
      // `setTimeout` coerces each of these into roughly 1ms, which would turn
      // a misconfigured timeout into "no timeout at all" with no signal.
      await expect(startCallbackListener({ timeoutMs })).rejects.toThrow(
        /timeoutMs/,
      )
    },
  )

  it('discards a buffered callback when closed before it is judged', async () => {
    const listener = await start()
    // The callback lands while nothing is armed, so it is buffered...
    expect(await hit(listener.redirectUri, VALID)).toBe(200)
    // ...and then the attempt is abandoned.
    listener.close()

    // Without this, the buffered callback outlived `close()` and a later arm
    // resolved it -- contradicting `close()`'s own contract.
    await expect(listener.awaitCallback('s-1')).rejects.toThrow(/closed/i)
  })

  it('clears the timeout once a callback has been accepted', async () => {
    // Implementation-coupled by necessity, and labelled as such: a cleared
    // `Timeout` still reports `hasRef() === true`, and the timeout callback
    // is a no-op once the promise has settled, so there is no observable
    // behaviour to assert instead. What this pins is the regression the
    // review identified -- a ref'd timer surviving a successful sign-in for
    // the rest of the timeout window.
    const cleared = jest.spyOn(global, 'clearTimeout')
    try {
      const listener = await start()
      const pending = listener.awaitCallback('s-1')
      expect(await hit(listener.redirectUri, VALID)).toBe(200)
      await expect(pending).resolves.toMatchObject({ code: 'c-1' })
      expect(cleared).toHaveBeenCalled()
    } finally {
      cleared.mockRestore()
    }
  })

  // The class, not just the message: `ChatGptConnectFlow` discriminates on
  // it to answer 408 with a body `code`, and a message-only check would pass
  // over a plain `Error` that reaches Nest as a default 500 with no code --
  // which is exactly the state this listener used to leave the UI in.
  it('rejects on timeout with its own error type', async () => {
    const listener = await start({ timeoutMs: 50 })
    const pending = listener.awaitCallback('s-1')
    await expect(pending).rejects.toBeInstanceOf(ChatGptSignInTimedOutError)
    await expect(pending).rejects.toThrow(/timed out/i)
  })

  it('starts the timeout at bind, so a listener that is never armed still frees its port', async () => {
    const listener = await start({ timeoutMs: 50 })
    const port = portOf(listener.redirectUri)
    expect(await accepts('127.0.0.1', port)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await accepts('127.0.0.1', port)).toBe(false)
    // Arming afterwards reports the timeout rather than hanging.
    await expect(listener.awaitCallback('s-1')).rejects.toThrow(/timed out/i)
  })

  it('does not raise an unhandled rejection when the listener fails unawaited', async () => {
    const unhandled: unknown[] = []
    const record = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', record)
    try {
      await start({ timeoutMs: 30 })
      // Nothing ever arms it. Give the timeout, and a later turn of the
      // event loop in which Node reports unhandled rejections, time to run.
      await new Promise((resolve) => setTimeout(resolve, 150))
    } finally {
      process.off('unhandledRejection', record)
    }
    expect(unhandled).toEqual([])
  })

  it('refuses a second arm', async () => {
    const listener = await start({ timeoutMs: 50 })
    listener.awaitCallback('s-1').catch(() => undefined)
    expect(() => listener.awaitCallback('s-2')).toThrow(/once/i)
    listener.close()
  })

  it('closes on the first request, so the callback is single-use', async () => {
    const listener = await start()
    const port = portOf(listener.redirectUri)
    const pending = listener.awaitCallback('s-1')
    await hit(listener.redirectUri, VALID)
    await pending
    expect(await accepts('127.0.0.1', port)).toBe(false)
  })

  it('closes on a first request that is rejected too', async () => {
    const listener = await start()
    const port = portOf(listener.redirectUri)
    const pending = listener.awaitCallback('s-1')
    await hit(listener.redirectUri, 'code=c-1&state=WRONG&client_id=abc123')
    await pending.catch(() => undefined)
    expect(await accepts('127.0.0.1', port)).toBe(false)
  })

  it('close() is idempotent, frees the port and fails a pending wait', async () => {
    const listener = await start()
    const port = portOf(listener.redirectUri)
    const pending = listener.awaitCallback('s-1')

    listener.close()
    expect(() => listener.close()).not.toThrow()

    await expect(pending).rejects.toThrow(/closed/i)
    expect(await accepts('127.0.0.1', port)).toBe(false)
  })

  it('close() before arming makes the later wait fail rather than hang', async () => {
    const listener = await start()
    listener.close()
    await expect(listener.awaitCallback('s-1')).rejects.toThrow(/closed/i)
  })

  it('never puts the code or the state in an error message', async () => {
    const listener = await start()
    const pending = listener.awaitCallback('s-1')
    await hit(
      listener.redirectUri,
      'code=secret-code&state=WRONG&client_id=abc123',
    )
    const error = await pending.then(
      () => undefined,
      (reason: Error) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).not.toContain('secret-code')
    expect(error?.message).not.toContain('s-1')
    expect(error?.message).not.toContain('WRONG')
  })

  it.each([
    // [query, the matching secret tokens that must not be echoed]
    ['code=tok-code&state=tok-attacker&client_id=abc123'],
    ['code=tok-code&state=tok-armed&client_id=tok-bad%20client'],
    ['code=tok-code&code=tok-code2&state=tok-armed&client_id=abc123'],
    ['code=tok-code&state=tok-armed&state=tok-attacker&client_id=abc123'],
  ])('keeps every submitted value out of the error for %p', async (query) => {
    const listener = await start()
    const pending = listener.awaitCallback('tok-armed')
    await hit(listener.redirectUri, query)
    const error = await pending.then(
      () => undefined,
      (reason: Error) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).not.toMatch(/tok-/)
  })

  describe('an OAuth error response', () => {
    // A refusal carries `error` and NO `code`, so without this branch it
    // arrives as "must carry exactly one non-empty code" and the user is
    // told something broke when in fact they declined.
    it('reports a declined consent as its own failure', async () => {
      const listener = await start()
      const pending = listener.awaitCallback('s-1')
      await hit(listener.redirectUri, 'error=access_denied&state=s-1')

      const error = await pending.then(
        () => undefined,
        (reason: unknown) => reason,
      )
      expect(error).toBeInstanceOf(ChatGptSignInDeniedError)
      expect((error as Error).message).toMatch(/declined/i)
    })

    it('reports any other error without echoing it', async () => {
      const listener = await start()
      const pending = listener.awaitCallback('s-1')
      await hit(
        listener.redirectUri,
        'error=tok-server_error&error_description=tok-free-text&state=s-1',
      )

      const error = await pending.then(
        () => undefined,
        (reason: unknown) => reason,
      )
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(ChatGptSignInDeniedError)
      // `error` and `error_description` are text from outside this process.
      expect((error as Error).message).not.toMatch(/tok-/)
      expect((error as Error).message).toMatch(/reported an error/i)
    })

    it('treats a repeated error parameter as an ambiguity, not a decline', async () => {
      const listener = await start()
      const pending = listener.awaitCallback('s-1')
      await hit(
        listener.redirectUri,
        'error=access_denied&error=access_denied&state=s-1',
      )

      await expect(pending).rejects.not.toBeInstanceOf(
        ChatGptSignInDeniedError,
      )
    })

    it('still judges the state first, so only this attempt can name a reason', async () => {
      // Any local process can reach this port. One that guesses no state
      // must not get to label the attempt "the user declined".
      const listener = await start()
      const pending = listener.awaitCallback('s-1')
      await hit(listener.redirectUri, 'error=access_denied&state=WRONG')

      const error = await pending.then(
        () => undefined,
        (reason: unknown) => reason,
      )
      expect(error).not.toBeInstanceOf(ChatGptSignInDeniedError)
      expect((error as Error).message).toMatch(/state/i)
    })
  })

  it('does not echo the requested path in the error message', async () => {
    const listener = await start()
    const pending = listener.awaitCallback('s-1')
    const origin = new URL(listener.redirectUri).origin
    await fetch(`${origin}/tok-secret-path`).catch(() => undefined)
    const error = await pending.then(
      () => undefined,
      (reason: Error) => reason,
    )
    expect(error?.message).not.toContain('tok-secret-path')
  })
})
