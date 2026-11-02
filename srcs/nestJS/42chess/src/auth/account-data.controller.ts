import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AUTH_RATE_LIMIT, EMAIL_RATE_LIMIT } from '../common/rate-limit.js';
import { AccessTokenGuard } from './access-token.guard.js';
import type { AuthenticatedRequest } from './access-token.guard.js';
import { AccountDataService } from './account-data.service.js';
import { DeleteAccountDto } from './dto/delete-account.dto.js';
import { REFRESH_COOKIE, refreshCookieOptions } from './session-cookie.js';

@Controller('v1/users')
export class AccountDataController {
  constructor(private readonly data: AccountDataService) {}

  /** Everything stored about the account, as a JSON file to download. */
  @Get('me/export')
  @UseGuards(AccessTokenGuard)
  @Throttle(EMAIL_RATE_LIMIT)
  @Header('Cache-Control', 'no-store')
  async export(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const data = await this.data.export(request.user.id);
    const day = new Date().toISOString().slice(0, 10);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="42chess-${request.user.username}-${day}.json"`,
    );
    // Indented, so that the file can be read as it is.
    response.type('application/json').send(JSON.stringify(data, null, 2));
  }

  @Delete('me')
  @UseGuards(AccessTokenGuard)
  @Throttle(AUTH_RATE_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.data.delete(request.user.id, dto);
    response.clearCookie(REFRESH_COOKIE, refreshCookieOptions(request, 0));
  }
}
