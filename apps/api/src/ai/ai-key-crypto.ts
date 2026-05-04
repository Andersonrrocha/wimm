import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto'

/**
 * AES-256-GCM authenticated encryption for stored API keys (BYOK).
 *
 * Format on disk (base64):
 *   [12 bytes IV][16 bytes auth tag][N bytes ciphertext]
 *
 * The key is derived from the `AI_KEY_ENCRYPTION_SECRET` env var via SHA-256
 * so any non-empty string is acceptable input — the operator's job is just
 * to keep the same secret across deploys (rotating it invalidates every
 * stored key).
 */
@Injectable()
export class AiKeyCrypto {
  private readonly key: Buffer

  constructor(config: ConfigService) {
    const secret = config.get<string>('AI_KEY_ENCRYPTION_SECRET')
    if (!secret || secret.length < 16) {
      throw new Error(
        'AI_KEY_ENCRYPTION_SECRET must be set to a string of 16+ chars',
      )
    }
    this.key = createHash('sha256').update(secret, 'utf8').digest()
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const enc = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, enc]).toString('base64')
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64')
    if (buf.length < 12 + 16 + 1) {
      throw new Error('Encrypted payload is too short')
    }
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const enc = buf.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(enc), decipher.final()])
    return dec.toString('utf8')
  }
}
