import { AiByokSource, AiCategorizationMode } from '@wimm/shared'
import en from '../i18n/locales/en.json'
import pt from '../i18n/locales/pt.json'
import {
  CHATGPT_SHARING_FAILURE_CODES,
  CHATGPT_SIGN_IN_TIMED_OUT_CODE,
  describeChatGptState,
} from './chatgpt-connection-state'

/** Every leaf key path, so a nested key cannot drift unnoticed. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix]
  }
  return Object.entries(value).flatMap(([key, nested]) =>
    keyPaths(nested, prefix ? `${prefix}.${key}` : key),
  )
}

function valueAt(bundle: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], bundle)
}

describe('locale parity', () => {
  it('defines exactly the same keys in en and pt', () => {
    const inEn = new Set(keyPaths(en))
    const inPt = new Set(keyPaths(pt))
    expect([...inEn].filter((key) => !inPt.has(key))).toEqual([])
    expect([...inPt].filter((key) => !inEn.has(key))).toEqual([])
  })

  it('leaves no value empty in either locale', () => {
    for (const [name, bundle] of [
      ['en', en],
      ['pt', pt],
    ] as const) {
      for (const path of keyPaths(bundle)) {
        const value = valueAt(bundle, path)
        expect(typeof value === 'string' && value.trim().length > 0).toBe(true)
        if (typeof value !== 'string' || !value.trim()) {
          throw new Error(`${name} has an empty value at ${path}`)
        }
      }
    }
  })
})

/**
 * Pairs the mapping with the bundles: a `messageKey` with no entry in a
 * locale renders as the raw key path in the UI, which the two tests above
 * cannot see because they only compare the bundles to each other.
 */
describe('every ChatGPT state message exists in both locales', () => {
  const base = {
    connected: true,
    sharing: true,
    online: true,
    mode: AiCategorizationMode.BYOK,
    hasAnthropicKey: false,
    byokSource: null,
    declined: false,
    failed: false,
  }

  const states = [
    // Every mode the shared enum defines, so a mode the mapping answers with
    // its own message cannot be added without its translation being checked.
    // `BYOK` is the healthy connection.
    ...Object.values(AiCategorizationMode).map((mode) => ({ ...base, mode })),
    // Every own-credential source the shared enum defines plus the unchosen
    // `null`, under the one condition that makes the stored value mean
    // anything: both sources available. Derived for the same reason as the
    // modes above -- a third source cannot be added in `@wimm/shared`
    // without whatever message the mapping answers it with being checked.
    ...[null, ...Object.values(AiByokSource)].map((byokSource) => ({
      ...base,
      hasAnthropicKey: true,
      byokSource,
    })),
    { ...base, connected: false, sharing: false },
    { ...base, connected: false, sharing: false, declined: true },
    { ...base, connected: false, sharing: false, failed: true },
    { ...base, connected: false, sharing: false, failed: true, online: false },
    // The API's own code, which only a failed connect carries, so it needs
    // the `!connected` shape -- the `CHATGPT_SHARING_FAILURE_CODES` row below
    // is built on a live connection and would not reach this branch.
    {
      ...base,
      connected: false,
      sharing: false,
      failed: true,
      errorCode: CHATGPT_SIGN_IN_TIMED_OUT_CODE,
    },
    { ...base, sharing: false },
    { ...base, online: false },
    { ...base, errorCode: 'something_new_from_openai' },
    ...CHATGPT_SHARING_FAILURE_CODES.map((errorCode) => ({ ...base, errorCode })),
  ]

  it.each(states.map((state) => [describeChatGptState(state).messageKey]))(
    '%s is translated in en and pt',
    (messageKey) => {
      for (const [name, bundle] of [
        ['en', en],
        ['pt', pt],
      ] as const) {
        const value = valueAt(bundle, messageKey)
        if (typeof value !== 'string' || !value.trim()) {
          throw new Error(`${name} has no translation for ${messageKey}`)
        }
        expect(typeof value).toBe('string')
      }
    },
  )
})
