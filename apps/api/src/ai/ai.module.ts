import { Module } from '@nestjs/common'
import { AiKeyCrypto } from './ai-key-crypto'
import { AiKeyResolverService } from './ai-key-resolver.service'
import { AnthropicCategorizerService } from './anthropic-categorizer.service'

@Module({
  providers: [AiKeyCrypto, AiKeyResolverService, AnthropicCategorizerService],
  exports: [AiKeyCrypto, AiKeyResolverService, AnthropicCategorizerService],
})
export class AiModule {}
