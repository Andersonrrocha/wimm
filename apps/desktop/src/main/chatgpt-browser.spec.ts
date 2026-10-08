/**
 * Behavioral proof for `chatgpt-browser.ts` -- Task 11 of the ChatGPT
 * plan-usage provider plan, the one piece of that feature that genuinely
 * needs Electron.
 *
 * **Why every test re-requires `./chatgpt-browser` from scratch.** `electron`
 * cannot be imported outside a real Electron process the normal way
 * (`require('electron')` in a plain Node process resolves to the *path
 * string* of the Electron binary, not the API surface -- so `shell` would be
 * `undefined` and `shell.openExternal` a `TypeError` at call time). Every
 * test therefore mocks it with `jest.doMock` -- never the hoisted
 * `jest.mock`, whose factory would run before this file's own bindings exist
 * to close over -- and then `require`s the module under test fresh, after
 * `jest.resetModules()`. This is the exact pattern `updater.spec.ts` uses and
 * documents for the same reason.
 *
 * **What this file proves, and what it deliberately does not.** Nothing here
 * drives a real browser: `shell.openExternal` is a double in every test, so
 * what is proven is which string this module hands over and when it refuses
 * to hand over anything at all. That no window of WIMM's own is ever opened
 * for a consent page is proven positively, by making `BrowserWindow`
 * construction observable (see `load`) and asserting the count stays zero --
 * not by the absence of a crash.
 */
type BrowserModule = typeof import('./chatgpt-browser')

interface Harness {
  openChatGptAuthorizeUrl: BrowserModule['openChatGptAuthorizeUrl']
  /** Every URL handed to `shell.openExternal`, in order. */
  opened: string[]
  /** Read through a method, so the live count is observed rather than a copy taken at load time. */
  browserWindowsConstructed: () => number
  /** How many times `require('electron')` has run. */
  electronRequired: () => number
}

/**
 * Loads a completely fresh `./chatgpt-browser` with a mocked `electron`.
 *
 * `openExternalRejectsWith`, when given, makes `shell.openExternal` reject
 * with it -- the normal case on a machine with no registered handler for
 * `https:`, and the path that would otherwise put the authorize URL (hence
 * `state` and `code_challenge`) into whatever logs the rethrown error.
 */
function load(options: { openExternalRejectsWith?: Error } = {}): Harness {
  jest.resetModules()
  const opened: string[] = []
  // Counts how many times the `electron` factory ran, so a test can prove the
  // module does not pull it in at import time.
  const electronRequired = { count: 0 }
  // Mutable counter shared with the mock below; read through a method so the
  // test observes the live value rather than a copy taken at load time.
  const constructed = { count: 0 }

  jest.doMock('electron', () => {
    electronRequired.count += 1
    return {
    shell: {
      openExternal: async (url: string) => {
        if (options.openExternalRejectsWith) {
          throw options.openExternalRejectsWith
        }
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
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-var-requires -- must be required AFTER the doMock call above, never statically imported.
  const mod = require('./chatgpt-browser') as BrowserModule
  return {
    openChatGptAuthorizeUrl: mod.openChatGptAuthorizeUrl,
    opened,
    browserWindowsConstructed: () => constructed.count,
    electronRequired: () => electronRequired.count,
  }
}

describe('openChatGptAuthorizeUrl', () => {
  it('opens an issuer-origin URL in the system browser', async () => {
    const harness = load()
    const url = 'https://auth.openai.com/authorize?client_id=dynamic_agent_client&state=s'
    await harness.openChatGptAuthorizeUrl(url)
    expect(harness.opened).toEqual([url])
  })

  it('does not require electron until it is actually called', async () => {
    // Not a style point. A static `import { shell } from 'electron'` put the
    // package on the module-load path of `local-api.ts`, and so of three
    // suites that had been electron-free. `electron/index.js` reads
    // `path.txt` and, when missing, `spawnSync`s a ~100 MB download or
    // throws -- and CI's ubuntu `verify` job, the one that runs `pnpm test`,
    // has no Electron cache step. Those suites would have fetched the binary
    // inside a Jest module load, or failed to load, on a clean runner.
    const harness = load()
    expect(harness.electronRequired()).toBe(0)

    await harness.openChatGptAuthorizeUrl('https://auth.openai.com/authorize')
    expect(harness.electronRequired()).toBe(1)
  })

  it('hands over the normalised URL, not the raw input', async () => {
    // Validating one string and opening another leaves the gate resting on
    // Node's parser and Chromium's agreeing about every input. WHATWG reads
    // the backslash below as a slash, so the host is the issuer's -- but a
    // lenient RFC 3986 consumer would read `evil.example`.
    const harness = load()
    const raw = 'https://auth.openai.com\\@evil.example/authorize'
    const normalised = new URL(raw).href

    await harness.openChatGptAuthorizeUrl(raw)

    expect(harness.opened).toEqual([normalised])
    expect(harness.opened[0]).not.toBe(raw)
  })

  it.each([
    ['a blob URL inheriting the issuer origin', 'blob:https://auth.openai.com/0b4d'],
    ['a userinfo prefix', 'https://auth.openai.com@evil.example/authorize'],
    ['a trailing-dot host', 'https://auth.openai.com./authorize'],
    ['a Cyrillic homograph host', 'https://auth.op\u0435nai.com/authorize'],
  ])('refuses %s', async (_why, hostile) => {
    const harness = load()
    await expect(harness.openChatGptAuthorizeUrl(hostile)).rejects.toThrow()
    expect(harness.opened).toEqual([])
  })

  it('carries no cause on the unparseable branch either', async () => {
    // Node's own `ERR_INVALID_URL` carries `.input` -- the whole URL. This is
    // the measured leak, not a hypothetical one, and it is the third throw
    // site, which the other no-leak tests did not reach.
    const harness = load()
    const failure = await harness
      .openChatGptAuthorizeUrl('not-a-url')
      .catch((error: Error) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).cause).toBeUndefined()
    expect((failure as Error).message).not.toContain('not-a-url')
  })

  it('never constructs a BrowserWindow', async () => {
    const harness = load()
    await harness.openChatGptAuthorizeUrl('https://auth.openai.com/authorize')
    expect(harness.browserWindowsConstructed()).toBe(0)
  })

  // `https://auth.openai.com.evil.example` and plain `http://` are the two
  // that pin the check down to a parsed-origin comparison: a naive
  // `startsWith('https://auth.openai.com')` passes the first, and a naive
  // hostname check passes the second. See `chatgpt-browser.ts` for why
  // failing closed here is right even though Task 3's discovery hardening
  // deliberately does not require same-origin for every endpoint.
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

  it('never constructs a BrowserWindow for a refused URL either', async () => {
    const harness = load()
    await expect(
      harness.openChatGptAuthorizeUrl('https://evil.example/authorize'),
    ).rejects.toThrow()
    expect(harness.browserWindowsConstructed()).toBe(0)
  })

  describe('the thrown error never carries the URL', () => {
    // `ChatGptConnectFlow.connect` rethrows whatever this module throws, and
    // Nest's default exception filter logs a non-`HttpException` stack -- so
    // a message built by interpolating the URL would put `state` and
    // `code_challenge` into the log. Asserted on both throwing paths, since
    // each has its own message.
    const refused =
      'https://evil.example/authorize?state=secret-state-value&code_challenge=secret-challenge-value'

    it('on the refusal path', async () => {
      const harness = load()
      let caught: unknown
      try {
        await harness.openChatGptAuthorizeUrl(refused)
      } catch (err) {
        caught = err
      }
      // Asserted outside the catch: assertions inside one never run when
      // nothing throws, which would quietly pass this test.
      expect(caught).toBeInstanceOf(Error)
      const message = (caught as Error).message
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toContain(refused)
      expect(message).not.toContain('secret-state-value')
      expect(message).not.toContain('secret-challenge-value')
      // No `cause` either: Node prints a cause's own message alongside the
      // error, so attaching one would reintroduce exactly what the static
      // message avoids.
      expect((caught as Error).cause).toBeUndefined()
    })

    it("on the path where shell.openExternal itself rejects, even when its own message quotes the URL", async () => {
      const url =
        'https://auth.openai.com/authorize?state=secret-state-value&code_challenge=secret-challenge-value'
      const harness = load({
        openExternalRejectsWith: new Error(`Failed to open ${url}: no handler registered for https:`),
      })

      let caught: unknown
      try {
        await harness.openChatGptAuthorizeUrl(url)
      } catch (err) {
        caught = err
      }

      expect(caught).toBeInstanceOf(Error)
      const message = (caught as Error).message
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toContain(url)
      expect(message).not.toContain('secret-state-value')
      expect(message).not.toContain('secret-challenge-value')
      // And the rejection that `shell.openExternal` produced -- whose own
      // message quotes the URL -- must not be reachable through `cause`.
      expect((caught as Error).cause).toBeUndefined()
    })
  })
})
