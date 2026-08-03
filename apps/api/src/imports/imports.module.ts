import { Module } from '@nestjs/common'
import { AiModule } from '../ai/ai.module'
import { CategoriesModule } from '../categories/categories.module'
import { CategorizationRulesModule } from '../categorization-rules/categorization-rules.module'
import { CsvSourceMappingService } from './csv-source-mapping.service'
import { ImportsController } from './imports.controller'
import { ImportsService } from './imports.service'

@Module({
  imports: [CategorizationRulesModule, CategoriesModule, AiModule],
  controllers: [ImportsController],
  providers: [ImportsService, CsvSourceMappingService],
})
export class ImportsModule {}
