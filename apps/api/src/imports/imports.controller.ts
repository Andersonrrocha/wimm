import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { FileInterceptor } from '@nestjs/platform-express'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { CommitImportDto } from './dto/commit-import.dto'
import { PreviewImportBody } from './dto/preview-import.dto'
import { ImportsService } from './imports.service'

const PREVIEW_MAX_BYTES = 5 * 1024 * 1024

@Controller('imports')
@UseGuards(AuthGuard('jwt'))
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('preview')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: PREVIEW_MAX_BYTES } }),
  )
  preview(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: PreviewImportBody,
  ) {
    return this.importsService.preview(user.sub, body.sourceId, file)
  }

  @Post('commit')
  commit(@CurrentUser() user: JwtPayload, @Body() dto: CommitImportDto) {
    return this.importsService.commit(user.sub, dto)
  }
}
