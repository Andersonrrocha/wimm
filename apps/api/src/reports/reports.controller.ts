import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { FutureCommitmentsQueryDto } from './dto/future-commitments-query.dto'
import { MonthlyQueryDto } from './dto/monthly-query.dto'
import { ReportsQueryDto } from './dto/reports-query.dto'
import { ReportsService } from './reports.service'

@Controller('reports')
@UseGuards(AuthGuard('jwt'))
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  summary(
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportsQueryDto,
  ) {
    return this.reportsService.summaryForUser(user.sub, query)
  }

  @Get('by-category')
  byCategory(
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportsQueryDto,
  ) {
    return this.reportsService.byCategoryForUser(user.sub, query)
  }

  @Get('monthly')
  monthly(
    @CurrentUser() user: JwtPayload,
    @Query() query: MonthlyQueryDto,
  ) {
    return this.reportsService.monthlyForUser(user.sub, query)
  }

  @Get('future-commitments')
  futureCommitments(
    @CurrentUser() user: JwtPayload,
    @Query() query: FutureCommitmentsQueryDto,
  ) {
    return this.reportsService.futureCommitmentsForUser(user.sub, query)
  }
}
