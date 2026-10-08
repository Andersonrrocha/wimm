import 'reflect-metadata'
import type { ConfigService } from '@nestjs/config'
import { AiByokSource } from '@wimm/shared'
import { AiKeyCrypto } from '../ai/ai-key-crypto'
import type { PrismaService } from '../prisma/prisma.service'
import { UsersService } from './users.service'

describe('UsersService', () => {
  const update = jest.fn()
  const findUnique = jest.fn()
  const prisma = { user: { update, findUnique } } as unknown as PrismaService
  // `canDecrypt` is part of the double because `hasAiApiKey` is now "a key
  // that still decrypts", not "a row with something in the column" -- see
  // `AiKeyCrypto.canDecrypt`. True here, so the tests below describe a user
  // whose stored key works.
  const canDecrypt = jest.fn(() => true)
  const aiKeyCrypto = {
    encrypt: jest.fn(() => 'encrypted'),
    canDecrypt,
  } as unknown as AiKeyCrypto
  let service: UsersService

  /** Every column `findByIdOrThrow` selects, as Prisma would return them. */
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'someone@example.com',
    username: 'someone',
    preferredLocale: 'pt',
    chartDateMode: 'BILLING_CYCLE',
    onboardedAt: null,
    subscriptionStatus: 'ACTIVE',
    subscriptionPlan: null,
    trialEndsAt: null,
    founderNumber: null,
    aiCategorizationMode: 'BYOK',
    aiByokSource: null,
    aiApiKeyEncrypted: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    canDecrypt.mockReturnValue(true)
    findUnique.mockResolvedValue(row())
    update.mockResolvedValue(undefined)
    service = new UsersService(prisma, aiKeyCrypto)
  })

  describe('findByIdOrThrow', () => {
    it('returns the stored aiByokSource', async () => {
      findUnique.mockResolvedValue(
        row({ aiByokSource: AiByokSource.CHATGPT_PLAN }),
      )

      const me = await service.findByIdOrThrow('user-1')

      expect(me.aiByokSource).toBe(AiByokSource.CHATGPT_PLAN)
    })

    it('returns null when nothing is chosen', async () => {
      expect((await service.findByIdOrThrow('user-1')).aiByokSource).toBeNull()
    })

    // The field has to be requested, or the response would carry `undefined`
    // and the client could not tell "not chosen" from "not told".
    it('selects the column', async () => {
      await service.findByIdOrThrow('user-1')

      const [args] = findUnique.mock.calls[0] as [{ select: Record<string, true> }]
      expect(args.select.aiByokSource).toBe(true)
    })

    // Unchanged guarantee, restated because this method now selects one more
    // AI column: the encrypted key is never in the response.
    it('still reports the key as a boolean and never returns the ciphertext', async () => {
      findUnique.mockResolvedValue(row({ aiApiKeyEncrypted: 'SENTINEL-CIPHERTEXT' }))

      const me = await service.findByIdOrThrow('user-1')

      expect(me.hasAiApiKey).toBe(true)
      expect(JSON.stringify(me)).not.toContain('SENTINEL-CIPHERTEXT')
    })

    /**
     * `hasAiApiKey` has to answer the question the *selector* asks.
     *
     * `AnthropicCategorizerService.hasCredentialFor` is
     * `resolveForUser(...) !== null`, and `AiKeyResolverService` returns null
     * for a key that no longer decrypts. While this was `!== null`, a user
     * with a stored-but-undecryptable key plus a live ChatGPT connection was
     * told a credential choice was pending and that no suggestion would be
     * made until they picked one -- while the backend had seen a single
     * source all along and was already suggesting through the plan. Picking
     * the Anthropic key then changed nothing, and the panel claimed the plan
     * was unused.
     *
     * The real `AiKeyCrypto`, not the double: the point is that the two sides
     * agree about an actual AES-GCM failure, which a stubbed boolean cannot
     * establish.
     */
    it('reports a key that no longer decrypts as no key at all', async () => {
      const secretA = 'a'.repeat(32)
      const secretB = 'b'.repeat(32)
      const crypto = (secret: string): AiKeyCrypto =>
        new AiKeyCrypto({ get: () => secret } as unknown as ConfigService)
      const ciphertext = crypto(secretA).encrypt('sk-ant-SENTINEL-USERS-KEY')
      findUnique.mockResolvedValue(row({ aiApiKeyEncrypted: ciphertext }))

      // Same ciphertext, read under the secret it was written with, then
      // under a different one. Only the second is the rotated-secret state.
      await expect(
        new UsersService(prisma, crypto(secretA)).findByIdOrThrow('user-1'),
      ).resolves.toMatchObject({ hasAiApiKey: true })

      const me = await new UsersService(prisma, crypto(secretB)).findByIdOrThrow(
        'user-1',
      )

      // Unusable, and the attempt neither threw into this fetch nor put the
      // ciphertext in the response.
      expect(me.hasAiApiKey).toBe(false)
      expect(JSON.stringify(me)).not.toContain(ciphertext)
    })
  })

  describe('updateMe', () => {
    const dataOf = () =>
      (update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data

    it('persists a chosen source', async () => {
      await service.updateMe('user-1', {
        aiByokSource: AiByokSource.CHATGPT_PLAN,
      })

      expect(dataOf()).toEqual({ aiByokSource: AiByokSource.CHATGPT_PLAN })
    })

    it('persists null as an explicit clear', async () => {
      await service.updateMe('user-1', { aiByokSource: null })

      // `toEqual` would treat a missing key and an explicit `undefined` as
      // equal, so this checks the key is present and holds `null`.
      const data = dataOf()
      expect(Object.keys(data)).toEqual(['aiByokSource'])
      expect(data.aiByokSource).toBeNull()
    })

    // The trap this guards: a patch that only changes the locale must not
    // wipe a choice the user made earlier.
    it('leaves the stored choice alone when the field is absent', async () => {
      await service.updateMe('user-1', { preferredLocale: 'en' })

      expect(dataOf()).toEqual({ preferredLocale: 'en' })
      expect(Object.keys(dataOf())).not.toContain('aiByokSource')
    })

    it('writes nothing at all for an empty patch', async () => {
      await service.updateMe('user-1', {})

      expect(update).not.toHaveBeenCalled()
    })
  })
})
