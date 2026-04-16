import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator'
import { SourceType } from '@prisma/client'

export class CreateSourceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string

  @IsEnum(SourceType)
  type!: SourceType
}
