import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { OAuthService } from './oauth.service.js';
import { OAuthProviders, providerName } from './oauth-provider.js';

function cookie(request: Request, name: string): string {
  const values = (request.headers.cookie ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
}
@Controller('v1/auth/oauth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly providers: OAuthProviders,
  ) {}
  private options(maxAge = 300000): CookieOptions {
    return {
      httpOnly: true,
      secure: this.providers.publicOrigin().startsWith('https:'),
      sameSite: 'lax',
      path: '/',
      maxAge,
    };
  }
  @Get('providers')
  @Header('Cache-Control', 'no-store')
  available() {
    return { providers: this.providers.enabled() };
  }

  @Get('accounts')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  accounts(@Req() request: AuthenticatedRequest) {
    return this.oauth.accounts(request.user.id);
  }

  @Post('exchange')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async exchange(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Non-simple header prevents cross-site form posts from consuming the handoff.
    if (request.headers['x-oauth-exchange'] !== '1')
      throw new UnauthorizedException();
    const result = await this.oauth.exchange(
      cookie(request, 'oauth_handoff'),
      cookie(request, 'oauth_browser'),
    );
    response.clearCookie('oauth_handoff', this.options(0));
    response.clearCookie('oauth_browser', this.options(0));
    return result;
  }
  @Post(':provider/link')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  async link(
    @Param('provider') name: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.oauth.start(providerName(name), request.session);
    response.cookie('oauth_browser', result.browser, this.options());
    return { authorizationUrl: result.authorizationUrl };
  }
  @Delete(':provider')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  async unlink(
    @Param('provider') name: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.oauth.unlink(providerName(name), request.user.id);
  }
  @Get(':provider')
  async start(@Param('provider') name: string, @Res() response: Response) {
    const result = await this.oauth.start(providerName(name));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.cookie('oauth_browser', result.browser, this.options());
    response.redirect(302, result.authorizationUrl);
  }
  @Get(':provider/callback')
  async callback(
    @Param('provider') name: string,
    @Query('state') state: unknown,
    @Query('code') code: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const origin = this.providers.publicOrigin();
    try {
      if (typeof state !== 'string' || typeof code !== 'string')
        throw new UnauthorizedException();
      const handoff = await this.oauth.callback(
        providerName(name),
        state,
        cookie(request, 'oauth_browser'),
        code,
      );
      response.cookie('oauth_handoff', handoff, this.options(60000));
      response.redirect(302, `${origin}/oauth/callback`);
    } catch (error) {
      response.clearCookie('oauth_handoff', this.options(0));
      response.clearCookie('oauth_browser', this.options(0));
      const code = (error as any)?.getResponse?.()?.code;
      response.redirect(
        302,
        `${origin}/oauth/callback?error=${code === 'OAUTH_EMAIL_IN_USE' ? 'existing-account' : 'failed'}`,
      );
    }
  }
}
