import 'reflect-metadata'
import { validate } from 'class-validator'
import { AiByokSource } from '@wimm/shared'
import type { AiKeyCrypto } from '../ai/ai-key-crypto'
import type { PrismaService } from '../prisma/prisma.service'
import { UpdateMeDto } from './dto/update-me.dto'
import { UsersService } from './users.service'

/**
 * `aiByokSource` is the persisted half of the own-credential choice
 * `AiCategorizerSelector` reads. These specs cover the two things that can
 * silently go wrong about a stored enum on a patch endpoint: a value outside
 * the enum reaching the column (the `CHECK` would then reject it as a 500
 * rather than the DTO as a 400), and the three-way `undefined`/`null`/value
 * distinction collapsing -- which would turn "leave my choice alone" into
 * "clear my choice" on every unrelated settings save.
 */
describe('UpdateMeDto.aiByokSource', () => {
  const dtoWith = (value: unknown): UpdateMeDto => {
    const dto = new UpdateMeDto()
    Object.assign(dto, { aiByokSource: value })
    return dto
  }

  const errorsFor = async (value: unknown): Promise<string[]> => {
    const errors = await validate(dtoWith(value))
    return errors
      .filter((e) => e.property === 'aiByokSource')
      .flatMap((e) => Object.keys(e.constraints ?? {}))
  }

  it.each([AiByokSource.ANTHROPIC_KEY, AiByokSource.CHATGPT_PLAN])(
    'accepts %s',
    async (value) => {
      expect(await errorsFor(value)).toEqual([])
    },
  )

  it('accepts null, which clears the choice', async () => {
    expect(await errorsFor(null)).toEqual([])
  })

  it('accepts the field being absent entirely', async () => {
    expect(await validate(new UpdateMeDto())).toEqual([])
  })

  // The column's CHECK constraint would reject these too, but as a database
  // error on a write, not as a 400 naming the field.
  it.each(['', 'anthropic', 'CHATGPT', 'ANTHROPIC_KEY ', 'SOMETHING_ELSE'])(
    'rejects %p',
    async (value) => {
      expect(await errorsFor(value)).toContain('isIn')
    },
  )

  it('rejects a non-string value', async () => {
    expect(await errorsFor(42)).toContain('isIn')
  })
})

describe('UsersService', () => {
  const update = jest.fn()
  const findUnique = jest.fn()
  const prisma = { user: { update, findUnique } } as unknown as PrismaService
  const aiKeyCrypto = { encrypt: jest.fn(() => 'encrypted') } as unknown as AiKeyCrypto
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
