import { Module } from '@nestjs/common'
import { CategoriesModule } from '../categories/categories.module'
import { CategorizationRulesModule } from '../categorization-rules/categorization-rules.module'
import { ImportsController } from './imports.controller'
import { ImportsService } from './imports.service'

@Module({
  imports: [CategorizationRulesModule, CategoriesModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
