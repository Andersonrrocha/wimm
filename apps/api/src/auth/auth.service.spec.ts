/**
 * `AuthService`'s login/register payload, over doubles for everything that
 * leaves the process and the **real** `AiKeyCrypto`.
 *
 * It exists for one reason: this payload is the only place in the API that
 * builds a `User` by hand, and until now nothing read it. Local mode never
 * does (restore and `refreshUser` both call `/users/me`), which is how it
 * came to be missing a required shared field while still compiling, and how
 * it could have answered `hasAiApiKey` differently from the route the
 * clients actually read. Both are now compile-and-test errors instead.
 *
 * Exercised through `login` rather than by reaching for the private
 * `issueTokensForUser`: register and login share it, and the public path is
 * the one that has to be right.
 */
import 'reflect-metadata'
import type { ConfigService } from '@nestjs/config'
import type { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { AiByokSource } from '@wimm/shared'
import { AiKeyCrypto } from '../ai/ai-key-crypto'
import type { DefaultCategoriesService } from '../categories/default-categories.service'
import type { PrismaService } from '../prisma/prisma.service'
import { AuthService } from './auth.service'

const SECRET = 'auth-service-spec-secret-0123456789'
const OTHER_SECRET = 'auth-service-spec-other-secret-9876'
const PASSWORD = 'correct horse battery staple'

const crypto = (secret: string): AiKeyCrypto =>
  new AiKeyCrypto({ get: () => secret } as unknown as ConfigService)

describe('AuthService login payload', () => {
  const findUnique = jest.fn()
  const createRefreshToken = jest.fn()
  const prisma = {
    user: { findUnique },
    refreshToken: { create: createRefreshToken },
  } as unknown as PrismaService
  const jwtService = {
    signAsync: jest.fn(async () => 'access-token'),
  } as unknown as JwtService
  const config = {
    getOrThrow: (key: string) =>
      key === 'JWT_ACCESS_EXPIRES_SEC' ? '900' : '30',
  } as unknown as ConfigService
  const defaultCategories = {
    ensureForUser: jest.fn(async () => undefined),
  } as unknown as DefaultCategoriesService

  /** Every column both `findUnique` calls need, as Prisma would return it. */
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'someone@example.com',
    username: 'someone',
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    preferredLocale: 'pt',
    chartDateMode: 'BILLING_CYCLE',
    onboardedAt: new Date('2026-02-03T04:05:06Z'),
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

  const login = async (
    overrides: Record<string, unknown> = {},
    aiKeyCrypto: AiKeyCrypto = crypto(SECRET),
  ) => {
    findUnique.mockResolvedValue(row(overrides))
    const service = new AuthService(
      prisma,
      jwtService,
      config,
      defaultCategories,
      aiKeyCrypto,
    )
    return (
      await service.login({ email: 'someone@example.com', password: PASSWORD })
    ).user
  }

  beforeEach(() => {
    jest.clearAllMocks()
    createRefreshToken.mockResolvedValue(undefined)
  })

  // Minor 3. The field was added to the shared `User` and this payload kept
  // compiling without it, because the type here was a structural copy rather
  // than the shared type.
  it('carries the stored aiByokSource', async () => {
    expect(await login({ aiByokSource: AiByokSource.CHATGPT_PLAN })).toMatchObject({
      aiByokSource: AiByokSource.CHATGPT_PLAN,
    })
    expect(await login()).toMatchObject({ aiByokSource: null })
  })

  // `User` declares its timestamps as ISO strings, which is what the wire has
  // always carried; the old inline type claimed `Date`.
  it('serialises its timestamps the way the shared type declares them', async () => {
    expect(await login()).toMatchObject({
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      onboardedAt: '2026-02-03T04:05:06.000Z',
      trialEndsAt: null,
    })
  })

  // Important 2. The same question `UsersService.findByIdOrThrow` answers, so
  // the two payloads cannot disagree about whether a second BYOK credential
  // exists -- and never the ciphertext.
  it('reports a key that no longer decrypts as no key at all', async () => {
    const ciphertext = crypto(SECRET).encrypt('sk-ant-SENTINEL-AUTH-KEY')

    expect(
      await login({ aiApiKeyEncrypted: ciphertext }, crypto(SECRET)),
    ).toMatchObject({ hasAiApiKey: true })

    const user = await login(
      { aiApiKeyEncrypted: ciphertext },
      crypto(OTHER_SECRET),
    )

    expect(user.hasAiApiKey).toBe(false)
    expect(JSON.stringify(user)).not.toContain(ciphertext)
  })

  it('reports no key when none is stored', async () => {
    expect(await login()).toMatchObject({ hasAiApiKey: false })
  })
})
