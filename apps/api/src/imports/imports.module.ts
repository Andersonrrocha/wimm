import { Module } from '@nestjs/common'
import { CategorizationRulesModule } from '../categorization-rules/categorization-rules.module'
import { ImportsController } from './imports.controller'
import { ImportsService } from './imports.service'

@Module({
  imports: [CategorizationRulesModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
