import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { createHash, randomBytes } from 'crypto'
import {
  AiByokSource,
  AiCategorizationMode,
  type AppLocale,
  ChartDateMode,
  parseEnum,
  SubscriptionPlan,
  SubscriptionStatus,
  type User,
} from '@wimm/shared'
import { AiKeyCrypto } from '../ai/ai-key-crypto'
import { DefaultCategoriesService } from '../categories/default-categories.service'
import { PrismaService } from '../prisma/prisma.service'
import type { LoginDto } from './dto/login.dto'
import type { RefreshTokenDto } from './dto/refresh-token.dto'
import type { RegisterDto } from './dto/register.dto'

/**
 * `user` is the shared `User`, not a structural copy of it.
 *
 * It used to be an inline type listing the fields by hand, and that is how a
 * required shared field went missing without breaking the build: when
 * `aiByokSource` was added to `User` in `packages/shared`, login and register
 * kept compiling while returning a `User`-shaped object that did not have it.
 * Nothing noticed because local mode never reads this payload -- restore and
 * `refreshUser` both call `/users/me` -- so the only cost was a response that
 * lied about its shape. Naming the shared type is what makes the *next*
 * addition a compile error here instead.
 *
 * Naming it also fixes a second, quieter mismatch: `User` declares its four
 * timestamps as ISO strings, which is what the wire has always carried
 * (`JSON.stringify` of a `Date` is its `toISOString()`), while this type
 * claimed `Date`. The conversion below is explicit for that reason; the bytes
 * on the wire are unchanged.
 */
export type AuthResponseBody = {
  accessToken: string
  refreshToken: string
  user: User
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly defaultCategories: DefaultCategoriesService,
    private readonly aiKeyCrypto: AiKeyCrypto,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseBody> {
    const email = dto.email.toLowerCase()
    const username = dto.username.toLowerCase()

    const [existingEmail, existingUsername] = await Promise.all([
      this.prisma.user.findUnique({ where: { email } }),
      this.prisma.user.findUnique({ where: { username } }),
    ])
    if (existingEmail) {
      throw new ConflictException('Email already registered')
    }
    if (existingUsername) {
      throw new ConflictException('Username already taken')
    }

    const passwordHash = await bcrypt.hash(dto.password, 12)
    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
      },
    })

    await this.defaultCategories.ensureForUser(user.id)

    return this.issueTokensForUser(user.id)
  }

  async login(dto: LoginDto): Promise<AuthResponseBody> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    })
    if (!user) {
      throw new UnauthorizedException('USER_NOT_FOUND')
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash)
    if (!ok) {
      throw new UnauthorizedException('INVALID_CREDENTIALS')
    }

    await this.defaultCategories.ensureForUser(user.id)

    return this.issueTokensForUser(user.id)
  }

  async refresh(dto: RefreshTokenDto): Promise<{
    accessToken: string
    refreshToken: string
  }> {
    const hash = this.hashRefreshToken(dto.refreshToken)
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    })

    if (!record || record.expiresAt < new Date()) {
      if (record) {
        await this.prisma.refreshToken.delete({ where: { id: record.id } })
      }
      throw new UnauthorizedException('Invalid or expired refresh token')
    }

    await this.prisma.refreshToken.delete({ where: { id: record.id } })

    const { accessToken, refreshToken } = await this.createTokens(
      record.user.id,
      record.user.email,
      record.user.username,
    )

    return { accessToken, refreshToken }
  }

  private async issueTokensForUser(userId: string): Promise<AuthResponseBody> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true,
        preferredLocale: true,
        chartDateMode: true,
        onboardedAt: true,
        subscriptionStatus: true,
        subscriptionPlan: true,
        trialEndsAt: true,
        founderNumber: true,
        aiCategorizationMode: true,
        aiByokSource: true,
        aiApiKeyEncrypted: true,
        updatedAt: true,
      },
    })
    if (!row) {
      throw new UnauthorizedException('User not found')
    }
    const { accessToken, refreshToken } = await this.createTokens(
      row.id,
      row.email,
      row.username,
    )
    return {
      accessToken,
      refreshToken,
      user: {
        id: row.id,
        email: row.email,
        username: row.username,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        // `AppLocale` has no runtime enum object to hand `parseEnum`, so
        // there is nothing to validate against here. The column is written
        // only through `UpdateMeDto`, which does validate it, and
        // `UsersService.findByIdOrThrow` passes the same value through
        // unchecked on the route the clients actually read.
        preferredLocale: row.preferredLocale as AppLocale,
        chartDateMode: parseEnum(ChartDateMode, row.chartDateMode, 'chartDateMode'),
        onboardedAt:
          row.onboardedAt === null ? null : row.onboardedAt.toISOString(),
        subscriptionStatus: parseEnum(
          SubscriptionStatus,
          row.subscriptionStatus,
          'subscriptionStatus',
        ),
        subscriptionPlan:
          row.subscriptionPlan === null
            ? null
            : parseEnum(SubscriptionPlan, row.subscriptionPlan, 'subscriptionPlan'),
        trialEndsAt:
          row.trialEndsAt === null ? null : row.trialEndsAt.toISOString(),
        founderNumber: row.founderNumber,
        aiCategorizationMode: parseEnum(
          AiCategorizationMode,
          row.aiCategorizationMode,
          'aiCategorizationMode',
        ),
        aiByokSource:
          row.aiByokSource === null
            ? null
            : parseEnum(AiByokSource, row.aiByokSource, 'aiByokSource'),
        // Usable, not merely present -- the identical expression
        // `UsersService.findByIdOrThrow` uses, deliberately, so the two
        // payloads cannot answer the same field differently. See
        // `AiKeyCrypto.canDecrypt`.
        hasAiApiKey:
          row.aiApiKeyEncrypted !== null &&
          this.aiKeyCrypto.canDecrypt(row.aiApiKeyEncrypted),
      },
    }
  }

  private async createTokens(
    userId: string,
    email: string,
    username: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessExpiresSec = Number.parseInt(
      this.config.getOrThrow<string>('JWT_ACCESS_EXPIRES_SEC'),
      10,
    )
    if (Number.isNaN(accessExpiresSec) || accessExpiresSec < 1) {
      throw new Error('Invalid JWT_ACCESS_EXPIRES_SEC')
    }
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, email, username },
      { expiresIn: accessExpiresSec },
    )

    const refreshPlain = randomBytes(48).toString('base64url')
    const tokenHash = this.hashRefreshToken(refreshPlain)
    const expiresAt = this.computeRefreshExpiry()

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    })

    return { accessToken, refreshToken: refreshPlain }
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex')
  }

  private computeRefreshExpiry(): Date {
    const daysRaw = this.config.getOrThrow<string>('REFRESH_TOKEN_EXPIRES_DAYS')
    const days = Number.parseInt(daysRaw, 10)
    if (Number.isNaN(days) || days < 1) {
      throw new Error(`Invalid REFRESH_TOKEN_EXPIRES_DAYS: ${daysRaw}`)
    }
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  }
}
