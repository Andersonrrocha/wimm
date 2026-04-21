import { Transform } from 'class-transformer'
import { IsEmail, IsString, Matches } from 'class-validator'

/** Letters, numbers, underscore, hyphen — stored lowercased */
const USERNAME_RE = /^[a-z0-9_-]{3,32}$/

/** Min 8, max 128; at least one upper, lower, digit, and non-alphanumeric (symbol) */
const PASSWORD_RE =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,128}$/

export class RegisterDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(USERNAME_RE, {
    message:
      'Username must be 3–32 characters (letters, numbers, underscore or hyphen)',
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
