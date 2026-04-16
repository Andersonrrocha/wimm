import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { CreateRecurrenceDto } from './dto/create-recurrence.dto'
import { MaterializeDto } from './dto/materialize.dto'
import { UpdateRecurrenceDto } from './dto/update-recurrence.dto'
import { RecurrencesService } from './recurrences.service'

@Controller('recurrences')
@UseGuards(AuthGuard('jwt'))
export class RecurrencesController {
  constructor(private readonly recurrencesService: RecurrencesService) {}

  @Post('materialize')
  materialize(
    @CurrentUser() user: JwtPayload,
    @Body() dto: MaterializeDto,
  ) {
    return this.recurrencesService.materializeForUser(user.sub, dto)
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.recurrencesService.listForUser(user.sub)
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateRecurrenceDto,
  ) {
    return this.recurrencesService.createForUser(user.sub, dto)
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recurrencesService.findOneForUser(user.sub, id)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurrenceDto,
  ) {
    return this.recurrencesService.updateForUser(user.sub, id, dto)
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recurrencesService.deleteForUser(user.sub, id)
  }
}
