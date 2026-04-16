import { ArrayMinSize, IsUUID } from 'class-validator'

export class BulkCategorizeDto {
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  transactionIds!: string[]

  @IsUUID()
  categoryId!: string
}
