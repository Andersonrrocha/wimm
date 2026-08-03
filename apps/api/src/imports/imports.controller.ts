import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { CsvSourceMappingService } from './csv-source-mapping.service'
import { CommitImportDto } from './dto/commit-import.dto'
import { SaveCsvSourceMappingDto } from './dto/csv-source-mapping.dto'
import { PreviewImportBody } from './dto/preview-import.dto'
import { ImportsService } from './imports.service'

const PREVIEW_MAX_BYTES = 5 * 1024 * 1024

@Controller('imports')
export class ImportsController {
  constructor(
    private readonly importsService: ImportsService,
    private readonly csvSourceMappings: CsvSourceMappingService,
  ) {}

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

  /**
   * Fetches the saved CSV mapping for a source, or `null` when the source
   * has none yet -- the mapping UI (Stage 2, Task 5) uses this to decide
   * whether to show "map columns" or "edit the saved mapping".
   */
  @Get('csv-mapping/:sourceId')
  getCsvMapping(
    @CurrentUser() user: JwtPayload,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
  ) {
    return this.csvSourceMappings.findForSource(user.sub, sourceId)
  }

  /**
   * Saves the CSV mapping for a source, or edits the existing one in place
   * (upsert on `sourceId`) -- so the next import from this source reuses it
   * without asking again.
   */
  @Put('csv-mapping/:sourceId')
  saveCsvMapping(
    @CurrentUser() user: JwtPayload,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @Body() dto: SaveCsvSourceMappingDto,
  ) {
    const { columnCount, ...mapping } = dto
    return this.csvSourceMappings.upsertForSource(
      user.sub,
      sourceId,
      mapping,
      columnCount,
    )
  }
}
