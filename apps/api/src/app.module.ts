import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
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
  providers: [AppService],
})
export class AppModule {}
