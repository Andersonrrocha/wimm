import { __resetApiModeCacheForTests, resolveApiMode, type ApiModeSource } from './api-mode'

describe('resolveApiMode', () => {
  beforeEach(() => {
    __resetApiModeCacheForTests()
  })

  it('resolves to what the source reports when main booted the embedded API', async () => {
    const source: ApiModeSource = { getMode: jest.fn().mockResolvedValue({ mode: 'local' }) }

    await expect(resolveApiMode(source)).resolves.toEqual({ mode: 'local' })
  })

  it('resolves to hosted when the source reports hosted -- the pre-4b behaviour is reachable, not just local mode', async () => {
    const source: ApiModeSource = { getMode: jest.fn().mockResolvedValue({ mode: 'hosted' }) }

    await expect(resolveApiMode(source)).resolves.toEqual({ mode: 'hosted' })
  })

  it('falls back to hosted when no source is supplied at all', async () => {
    await expect(resolveApiMode(undefined)).resolves.toEqual({ mode: 'hosted' })
  })

  it('calls the source at most once and caches the result for subsequent calls', async () => {
    const getMode = jest.fn().mockResolvedValue({ mode: 'local' })
    const source: ApiModeSource = { getMode }

    await resolveApiMode(source)
    await resolveApiMode(source)
    await resolveApiMode(source)

    expect(getMode).toHaveBeenCalledTimes(1)
  })

  it('does not call a second source once the first call has already resolved and cached a result', async () => {
    const first: ApiModeSource = { getMode: jest.fn().mockResolvedValue({ mode: 'local' }) }
    const second: ApiModeSource = { getMode: jest.fn().mockResolvedValue({ mode: 'hosted' }) }

    await resolveApiMode(first)
    const result = await resolveApiMode(second)

    expect(result).toEqual({ mode: 'local' })
    expect(second.getMode).not.toHaveBeenCalled()
  })
})
