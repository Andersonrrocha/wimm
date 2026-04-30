import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { AuthModule } from './auth/auth.module'
import { CategoriesModule } from './categories/categories.module'
import { CategorizationRulesModule } from './categorization-rules/categorization-rules.module'
import { ImportsModule } from './imports/imports.module'
import { PrismaModule } from './prisma/prisma.module'
import { RecurrencesModule } from './recurrences/recurrences.module'
import { ReportsModule } from './reports/reports.module'
import { SourcesModule } from './sources/sources.module'
import { TransactionsModule } from './transactions/transactions.module'
import { UsersModule } from './users/users.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Default rate limit: 200 req/min per IP. Auth routes get tighter overrides.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 200 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    SourcesModule,
    CategoriesModule,
    CategorizationRulesModule,
    TransactionsModule,
    ImportsModule,
    RecurrencesModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
