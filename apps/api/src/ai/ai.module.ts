import { Module } from '@nestjs/common'
import { AiKeyResolverService } from './ai-key-resolver.service'
import { AnthropicCategorizerService } from './anthropic-categorizer.service'

@Module({
  providers: [AiKeyResolverService, AnthropicCategorizerService],
  exports: [AiKeyResolverService, AnthropicCategorizerService],
})
export class AiModule {}
