import { Module } from '@nestjs/common'
import { CategorizationRulesController } from './categorization-rules.controller'
import { CategorizationRulesService } from './categorization-rules.service'

@Module({
  controllers: [CategorizationRulesController],
  providers: [CategorizationRulesService],
  exports: [CategorizationRulesService],
})
export class CategorizationRulesModule {}
