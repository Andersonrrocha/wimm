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
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { CreateSourceDto } from './dto/create-source.dto'
import { UpdateSourceDto } from './dto/update-source.dto'
import { SourcesService } from './sources.service'

@Controller('sources')
@UseGuards(AuthGuard('jwt'))
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.sourcesService.findAllForUser(user.sub)
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sourcesService.findOneForUser(user.sub, id)
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSourceDto) {
    return this.sourcesService.createForUser(user.sub, dto)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSourceDto,
  ) {
    return this.sourcesService.updateForUser(user.sub, id, dto)
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sourcesService.deleteForUser(user.sub, id)
  }
}
