import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { SourceType } from '@prisma/client'

export class UpdateSourceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string

  @IsOptional()
  @IsEnum(SourceType)
  type?: SourceType
}
