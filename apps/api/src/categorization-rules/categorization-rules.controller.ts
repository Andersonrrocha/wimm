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
import { CategorizationRulesService } from './categorization-rules.service'
import { CreateCategorizationRuleDto } from './dto/create-categorization-rule.dto'
import { UpdateCategorizationRuleDto } from './dto/update-categorization-rule.dto'

@Controller('categorization-rules')
@UseGuards(AuthGuard('jwt'))
export class CategorizationRulesController {
  constructor(
    private readonly categorizationRulesService: CategorizationRulesService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.categorizationRulesService.listForUser(user.sub)
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCategorizationRuleDto,
  ) {
    return this.categorizationRulesService.createForUser(user.sub, dto)
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.categorizationRulesService.findOneForUser(user.sub, id)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategorizationRuleDto,
  ) {
    return this.categorizationRulesService.updateForUser(user.sub, id, dto)
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.categorizationRulesService.deleteForUser(user.sub, id)
  }
}
