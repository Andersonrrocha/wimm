import 'reflect-metadata'
import { validate } from 'class-validator'
import { AiByokSource } from '@wimm/shared'
import { UpdateMeDto } from './update-me.dto'

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
