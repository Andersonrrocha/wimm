import { IsUUID } from 'class-validator'

export class PreviewImportBody {
  @IsUUID()
  sourceId!: string
}
