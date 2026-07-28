import 'reflect-metadata'
import { validate } from 'class-validator'
import { CreateTransactionDto } from '../transactions/dto/create-transaction.dto'
import { UpdateTransactionDto } from '../transactions/dto/update-transaction.dto'
import { CreateRecurrenceDto } from '../recurrences/dto/create-recurrence.dto'
import { UpdateRecurrenceDto } from '../recurrences/dto/update-recurrence.dto'
import { CommitImportRowDto } from '../imports/dto/commit-import.dto'

/**
 * `amountCents` is a PostgreSQL `INTEGER` (int4): max value 2147483647,
 * i.e. 21474836.47 in decimal currency units. Every money DTO must reject
 * anything above that ceiling with a 400 at validation time, not let it
 * reach Postgres and surface as an unhandled 500.
 *
 * SQLite's `INTEGER` is 64-bit and would silently accept a value the
 * Postgres build rejects, so this bound also keeps both builds behaving
 * identically.
 */
const ACCEPTED_CEILING = 21474836.47
const REJECTED_ABOVE_CEILING = 21474836.48

function amountConstraints(errors: Array<{ property: string; constraints?: Record<string, string> }>): string[] {
  const amountError = errors.find((e) => e.property === 'amount')
  return amountError ? Object.keys(amountError.constraints ?? {}) : []
}

type DtoCase = {
  name: string
  build: (amount: number) => object
}

const cases: DtoCase[] = [
  {
    name: 'CreateTransactionDto',
    build: (amount) => {
      const dto = new CreateTransactionDto()
      dto.amount = amount
      return dto
    },
  },
  {
    name: 'UpdateTransactionDto',
    build: (amount) => {
      const dto = new UpdateTransactionDto()
      dto.amount = amount
      return dto
    },
  },
  {
    name: 'CreateRecurrenceDto',
    build: (amount) => {
      const dto = new CreateRecurrenceDto()
      dto.amount = amount
      return dto
    },
  },
  {
    name: 'UpdateRecurrenceDto',
    build: (amount) => {
      const dto = new UpdateRecurrenceDto()
      dto.amount = amount
      return dto
    },
  },
  {
    name: 'CommitImportRowDto',
    build: (amount) => {
      const dto = new CommitImportRowDto()
      dto.amount = amount
      return dto
    },
  },
]

describe('money DTO amount bounds (int4 ceiling in cents)', () => {
  it.each(cases)(
    '$name accepts the int4 ceiling (21474836.47)',
    async ({ build }) => {
      const errors = await validate(build(ACCEPTED_CEILING))
      expect(amountConstraints(errors)).not.toContain('max')
    },
  )

  it.each(cases)(
    '$name rejects amounts above the int4 ceiling (21474836.48)',
    async ({ build }) => {
      const errors = await validate(build(REJECTED_ABOVE_CEILING))
      expect(amountConstraints(errors)).toContain('max')
    },
  )
})
