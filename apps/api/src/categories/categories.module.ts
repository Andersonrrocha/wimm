import { Module } from '@nestjs/common'
import { CategoriesController } from './categories.controller'
import { CategoriesService } from './categories.service'
import { DefaultCategoriesService } from './default-categories.service'

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, DefaultCategoriesService],
  exports: [CategoriesService, DefaultCategoriesService],
})
export class CategoriesModule {}
