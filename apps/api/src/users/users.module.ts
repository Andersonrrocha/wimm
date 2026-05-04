import { Module } from '@nestjs/common'
import { AiModule } from '../ai/ai.module'
import { AuthModule } from '../auth/auth.module'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
  imports: [AuthModule, AiModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
