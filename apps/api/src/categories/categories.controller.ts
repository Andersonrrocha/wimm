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
import { CategoriesService } from './categories.service'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'

@Controller('categories')
@UseGuards(AuthGuard('jwt'))
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.categoriesService.findAllForUser(user.sub)
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.categoriesService.findOneForUser(user.sub, id)
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.createForUser(user.sub, dto)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.updateForUser(user.sub, id, dto)
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.categoriesService.deleteForUser(user.sub, id)
  }
}
