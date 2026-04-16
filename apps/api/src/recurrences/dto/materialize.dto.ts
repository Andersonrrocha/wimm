import { IsDateString, IsOptional, IsUUID } from 'class-validator'

export class MaterializeDto {
  @IsDateString()
  until!: string

  @IsOptional()
  @IsUUID()
  recurrenceId?: string
}
