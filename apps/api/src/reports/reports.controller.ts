import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { CurrentUser } from '../common/decorators/current-user.decorator'
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
}
