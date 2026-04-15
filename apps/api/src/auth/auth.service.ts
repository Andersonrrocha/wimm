import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { createHash, randomBytes } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import type { LoginDto } from './dto/login.dto'
import type { RefreshTokenDto } from './dto/refresh-token.dto'
import type { RegisterDto } from './dto/register.dto'

export type AuthResponseBody = {
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    createdAt: Date
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseBody> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    })
    if (existing) {
      throw new ConflictException('Email already registered')
    }

    const passwordHash = await bcrypt.hash(dto.password, 12)
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
      },
    })

    return this.issueTokensForUser(user.id, user.email, user.createdAt)
  }

  async login(dto: LoginDto): Promise<AuthResponseBody> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    })
    if (!user) {
      throw new UnauthorizedException('Invalid credentials')
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash)
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials')
    }

    return this.issueTokensForUser(user.id, user.email, user.createdAt)
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
    )

    return { accessToken, refreshToken }
  }

  private async issueTokensForUser(
    userId: string,
    email: string,
    createdAt: Date,
  ): Promise<AuthResponseBody> {
    const { accessToken, refreshToken } = await this.createTokens(userId, email)
    return {
      accessToken,
      refreshToken,
      user: { id: userId, email, createdAt },
    }
  }

  private async createTokens(
    userId: string,
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessExpiresSec = Number.parseInt(
      this.config.getOrThrow<string>('JWT_ACCESS_EXPIRES_SEC'),
      10,
    )
    if (Number.isNaN(accessExpiresSec) || accessExpiresSec < 1) {
      throw new Error('Invalid JWT_ACCESS_EXPIRES_SEC')
    }
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, email },
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
