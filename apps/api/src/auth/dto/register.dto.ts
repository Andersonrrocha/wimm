import { Transform } from 'class-transformer'
import { IsEmail, IsString, Matches } from 'class-validator'

/**
 * Display-style name: letters (any script / accents), digits, spaces,
 * underscore, hyphen. Stored trimmed, lowercased, single spaces.
 */
const USERNAME_RE = /^[\p{L}0-9 _-]{3,32}$/u

/** Min 8, max 128; at least one upper, lower, digit, and non-alphanumeric (symbol) */
const PASSWORD_RE =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,128}$/

export class RegisterDto {
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value
    return value.trim().toLowerCase().replace(/\s+/g, ' ')
  })
  @Matches(USERNAME_RE, {
    message:
      'Username must be 3–32 characters: letters, numbers, spaces, underscore or hyphen',
  })
  username!: string

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string

  @IsString()
  @Matches(PASSWORD_RE, {
    message:
      'Password must be 8–128 characters and include upper and lower case letters, a number, and a symbol',
  })
  password!: string
}
