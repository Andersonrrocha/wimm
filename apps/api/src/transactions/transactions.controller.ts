import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { BulkCategorizeDto } from './dto/bulk-categorize.dto'
import { CreateTransactionDto } from './dto/create-transaction.dto'
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto'
import { UpdateTransactionDto } from './dto/update-transaction.dto'
import { TransactionsService } from './transactions.service'

@Controller('transactions')
@UseGuards(AuthGuard('jwt'))
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.transactionsService.listForUser(user.sub, query)
  }

  @Post('bulk-categorize')
  bulkCategorize(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BulkCategorizeDto,
  ) {
    return this.transactionsService.bulkCategorizeForUser(user.sub, dto)
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateTransactionDto) {
    return this.transactionsService.createForUser(user.sub, dto)
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transactionsService.findOneForUser(user.sub, id)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransactionDto,
  ) {
    return this.transactionsService.updateForUser(user.sub, id, dto)
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transactionsService.deleteForUser(user.sub, id)
  }
}
