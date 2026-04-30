import { Module } from '@nestjs/common'
import { CategoriesModule } from '../categories/categories.module'
import { CategorizationRulesController } from './categorization-rules.controller'
import { CategorizationRulesService } from './categorization-rules.service'

@Module({
  imports: [CategoriesModule],
  controllers: [CategorizationRulesController],
  providers: [CategorizationRulesService],
  exports: [CategorizationRulesService],
})
export class CategorizationRulesModule {}
