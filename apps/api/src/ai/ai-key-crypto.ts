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
 * The key is derived from a secret via SHA-256 so any non-empty string is
 * acceptable input — the caller's job is just to keep the same secret
 * available for as long as a value encrypted under it needs to stay
 * decryptable (rotating it invalidates every stored key encrypted with the
 * old one).
 *
 * `deriveAiKeyEncryptionKey` / `encryptWithAiKey` / `decryptWithAiKey` below
 * are standalone functions, not private methods on `AiKeyCrypto`, so that
 * `profile-secret.ts`'s migration path (re-encrypting a profile's BYOK key
 * from the legacy shared secret to a per-profile one, see that module's doc
 * comment) can perform the exact same encrypt/decrypt this class uses
 * without going through Nest DI or a `ConfigService` -- there is no request
 * in flight yet at that point, only a caller-supplied secret string. Two
 * independent implementations of this format would be a correctness risk
 * disguised as a convenience: they would only need to disagree once for a
 * migration to "succeed" while writing something `AiKeyCrypto` itself could
 * never decrypt again.
 */
export function deriveAiKeyEncryptionKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

export function encryptWithAiKey(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptWithAiKey(key: Buffer, payload: string): string {
  const buf = Buffer.from(payload, 'base64')
  if (buf.length < 12 + 16 + 1) {
    throw new Error('Encrypted payload is too short')
  }
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return dec.toString('utf8')
}

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
    this.key = deriveAiKeyEncryptionKey(secret)
  }

  encrypt(plaintext: string): string {
    return encryptWithAiKey(this.key, plaintext)
  }

  decrypt(payload: string): string {
    return decryptWithAiKey(this.key, payload)
  }

  /**
   * Whether `payload` still decrypts under the configured secret -- the
   * question "is there a usable BYOK key?", asked without handing the key
   * back.
   *
   * It exists because *presence* and *usability* are different questions and
   * the codebase was answering the user-facing one with the cheaper of the
   * two. A stored value stops decrypting when the encryption secret changes
   * under it (`AiKeyResolverService` documents the rotated-secret path, and
   * `apps/desktop/src/main/local-api.ts` logs a dedicated warning for the
   * profile-secret migration that can leave exactly this behind), and from
   * that moment `AiKeyResolverService.resolveForUser` -- and therefore
   * `AnthropicCategorizerService.hasCredentialFor`, and therefore which
   * provider actually runs -- treats the user as having no key. A `!== null`
   * check disagrees, which is how the settings panel came to assert that a
   * credential choice was pending when the backend had already made it.
   *
   * Here rather than in each caller so `UsersService` and `AuthService`
   * cannot drift apart on it, and so the swallow lives in one place: a
   * decrypt attempt on a read path must never throw into a user fetch, and
   * neither the key nor the ciphertext is logged, returned or put in a
   * message. The plaintext is discarded inside this method and never leaves
   * it.
   */
  canDecrypt(payload: string): boolean {
    try {
      decryptWithAiKey(this.key, payload)
      return true
    } catch {
      return false
    }
  }
}
