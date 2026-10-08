import { Logger } from '@nestjs/common'
import { AiByokSource, AiCategorizationMode } from '@wimm/shared'
import { AiCategorizerSelector } from './ai-categorizer-selector.service'
import type { AiProvider } from './ai-provider.interface'
import { AiProviderRegistry } from './ai-provider.registry'
import type { PrismaService } from '../prisma/prisma.service'

/**
 * Two providers, each with the id the real one carries and its own
 * `hasCredentialFor` double.
 *
 * **They must be distinct objects with distinct ids.** A single shared double
 * standing in for both would make "returns Anthropic" and "returns ChatGPT"
 * the same assertion, and a `selectFor` hardcoded to one provider would pass
 * every case below. Every expectation is on `provider?.id`, so the two
 * outcomes are never interchangeable.
 */
function provider(id: string, available: boolean | Error): AiProvider {
  return {
    id,
    hasCredentialFor: jest
      .fn()
      .mockImplementation(() =>
        available instanceof Error
          ? Promise.reject(available)
          : Promise.resolve(available),
      ),
    categorizeBatch: jest.fn().mockResolvedValue([]),
  }
}

type UserRow = {
  aiCategorizationMode: string
  aiByokSource: string | null
} | null

/**
 * Builds the selector over a real `AiProviderRegistry` -- the registry's
 * `get` is the dispatch under test here, so substituting it would prove
 * nothing -- plus a Prisma double that answers one `user.findUnique`.
 */
function build(options: {
  user: UserRow
  providers?: AiProvider[]
}): { selector: AiCategorizerSelector; findUnique: jest.Mock } {
  const findUnique = jest.fn().mockResolvedValue(options.user)
  const prisma = { user: { findUnique } } as unknown as PrismaService
  const registry = new AiProviderRegistry(options.providers ?? [])
  return { selector: new AiCategorizerSelector(prisma, registry), findUnique }
}

const anthropic = (available: boolean | Error = true) =>
  provider('anthropic', available)
const chatgpt = (available: boolean | Error = true) =>
  provider('chatgpt-oauth', available)

describe('AiCategorizerSelector', () => {
  it('reads only the two fields it decides from, for the requesting user', async () => {
    const { selector, findUnique } = build({
      user: { aiCategorizationMode: AiCategorizationMode.OFF, aiByokSource: null },
    })

    await selector.selectFor('user-1')

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { aiCategorizationMode: true, aiByokSource: true },
    })
  })

  it('suggests nothing, and asks nothing, for a user row that does not exist', async () => {
    const { selector } = build({ user: null, providers: [anthropic(), chatgpt()] })

    expect(await selector.selectFor('user-1')).toEqual({
      provider: null,
      needsChoice: false,
    })
  })

  describe('OFF', () => {
    it('suggests nothing and asks nothing', async () => {
      const { selector } = build({
        user: { aiCategorizationMode: AiCategorizationMode.OFF, aiByokSource: null },
        providers: [anthropic(), chatgpt()],
      })

      expect(await selector.selectFor('user-1')).toEqual({
        provider: null,
        needsChoice: false,
      })
    })
  })

  describe('SERVER', () => {
    it('uses the Anthropic provider', async () => {
      const { selector } = build({
        user: {
          aiCategorizationMode: AiCategorizationMode.SERVER,
          aiByokSource: null,
        },
        providers: [anthropic(), chatgpt()],
      })

      const selection = await selector.selectFor('user-1')

      expect(selection.provider?.id).toBe('anthropic')
      expect(selection.needsChoice).toBe(false)
    })

    // SERVER means the server's own key pays. A connected personal plan, and
    // a stored choice naming it, must not redirect the spend onto the user's
    // own allowance -- the explicit mode wins over both.
    it('uses the Anthropic provider even with a live ChatGPT connection and aiByokSource CHATGPT_PLAN', async () => {
      const chat = chatgpt(true)
      const { selector } = build({
        user: {
          aiCategorizationMode: AiCategorizationMode.SERVER,
          aiByokSource: AiByokSource.CHATGPT_PLAN,
        },
        providers: [anthropic(), chat],
      })

      const selection = await selector.selectFor('user-1')

      expect(selection.provider?.id).toBe('anthropic')
      expect(selection.needsChoice).toBe(false)
      // Not even asked: availability is irrelevant under SERVER.
      expect(chat.hasCredentialFor).not.toHaveBeenCalled()
    })

    it('suggests nothing when no Anthropic provider is registered at all', async () => {
      const { selector } = build({
        user: {
          aiCategorizationMode: AiCategorizationMode.SERVER,
          aiByokSource: null,
        },
        providers: [chatgpt()],
      })

      expect(await selector.selectFor('user-1')).toEqual({
        provider: null,
        needsChoice: false,
      })
    })
  })

  describe('BYOK', () => {
    const byok = (aiByokSource: string | null) => ({
      aiCategorizationMode: AiCategorizationMode.BYOK,
      aiByokSource,
    })

    it('uses the Anthropic key when it is the only source available', async () => {
      const { selector } = build({
        user: byok(null),
        providers: [anthropic(true), chatgpt(false)],
      })

      const selection = await selector.selectFor('user-1')

      expect(selection.provider?.id).toBe('anthropic')
      expect(selection.needsChoice).toBe(false)
    })

    // The stored choice is a tie-breaker, not a filter. A user who once
    // picked CHATGPT_PLAN and has since disconnected it still has a usable
    // Anthropic key, and must not be asked to choose between one thing.
    it('ignores a stored CHATGPT_PLAN choice when only the Anthropic key is available', async () => {
      const { selector } = build({
        user: byok(AiByokSource.CHATGPT_PLAN),
        providers: [anthropic(true), chatgpt(false)],
      })

      const selection = await selector.selectFor('user-1')

      expect(selection.provider?.id).toBe('anthropic')
      expect(selection.needsChoice).toBe(false)
    })

    it('uses the ChatGPT plan when it is the only source available and nothing is chosen', async () => {
      const { selector } = build({
        user: byok(null),
        providers: [anthropic(false), chatgpt(true)],
      })

      const selection = await selector.selectFor('user-1')

      expect(selection.provider?.id).toBe('chatgpt-oauth')
      expect(selection.needsChoice).toBe(false)
    })

    it('ignores a stored ANTHROPIC_KEY choice when only the ChatGPT plan is available', async () => {
      const { selector } = build({
        user: byok(AiByokSource.ANTHROPIC_KEY),
        providers: [anthropic(false), chatgpt(true)],
      })

      const selection = await selector.selectFor('user-1')

      expect(selection.provider?.id).toBe('chatgpt-oauth')
      expect(selection.needsChoice).toBe(false)
    })

    it('uses the ChatGPT plan when both are available and CHATGPT_PLAN is chosen', async () => {
      const { selector } = build({
        user: byok(AiByokSource.CHATGPT_PLAN),
        providers: [anthropic(true), chatgpt(true)],
      })

      const selection = await selector.selectFor('user-1')

      expect(selection.provider?.id).toBe('chatgpt-oauth')
      expect(selection.needsChoice).toBe(false)
    })

    it('uses the Anthropic key when both are available and ANTHROPIC_KEY is chosen', async () => {
      const { selector } = build({
        user: byok(AiByokSource.ANTHROPIC_KEY),
        providers: [anthropic(true), chatgpt(true)],
      })

      const selection = await selector.selectFor('user-1')

      expect(selection.provider?.id).toBe('anthropic')
      expect(selection.needsChoice).toBe(false)
    })

    // Nothing is guessed. Defaulting to either source would spend one of the
    // user's own credentials on a decision they were never shown.
    it('asks when both are available and nothing is chosen', async () => {
      const { selector } = build({
        user: byok(null),
        providers: [anthropic(true), chatgpt(true)],
      })

      expect(await selector.selectFor('user-1')).toEqual({
        provider: null,
        needsChoice: true,
      })
    })

    it('asks when both are available and the stored choice is not a known source', async () => {
      const { selector } = build({
        user: byok('SOMETHING_ELSE'),
        providers: [anthropic(true), chatgpt(true)],
      })

      expect(await selector.selectFor('user-1')).toEqual({
        provider: null,
        needsChoice: true,
      })
    })

    it('suggests nothing, and asks nothing, when neither source is available', async () => {
      const { selector } = build({
        user: byok(AiByokSource.CHATGPT_PLAN),
        providers: [anthropic(false), chatgpt(false)],
      })

      expect(await selector.selectFor('user-1')).toEqual({
        provider: null,
        needsChoice: false,
      })
    })

    it('suggests nothing when no provider is registered', async () => {
      const { selector } = build({ user: byok(null), providers: [] })

      expect(await selector.selectFor('user-1')).toEqual({
        provider: null,
        needsChoice: false,
      })
    })

    // A provider that cannot answer is unavailable, and the failure stops
    // there: letting it propagate would discard the other source's answer
    // too, so a working Anthropic key would produce no suggestions because
    // an unrelated store read failed.
    it('keeps the other source usable when one provider rejects, and does not throw', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation()

      try {
        const { selector } = build({
          user: byok(null),
          providers: [anthropic(true), chatgpt(new Error('store unreadable'))],
        })

        const selection = await selector.selectFor('user-1')

        expect(selection.provider?.id).toBe('anthropic')
        expect(selection.needsChoice).toBe(false)
        expect(warn).toHaveBeenCalledWith(
          'AI provider "chatgpt-oauth" could not report credential availability: store unreadable',
        )
      } finally {
        warn.mockRestore()
      }
    })

    it('suggests nothing, rather than throwing, when the only provider rejects', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation()

      try {
        const { selector } = build({
          user: byok(null),
          providers: [chatgpt(new Error('store unreadable'))],
        })

        expect(await selector.selectFor('user-1')).toEqual({
          provider: null,
          needsChoice: false,
        })
      } finally {
        warn.mockRestore()
      }
    })
  })
})
