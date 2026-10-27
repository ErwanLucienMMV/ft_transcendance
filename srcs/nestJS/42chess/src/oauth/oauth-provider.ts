import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';
import { createHash } from 'node:crypto';

export type Provider = 'google' | 'github';
export interface ProviderIdentity {
  id: string;
  email: string | null;
}
export const OAUTH_FETCH = Symbol('OAUTH_FETCH');
export interface ProviderConfig {
  id: string;
  secret: string;
  callback: string;
}
const endpoints = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    profile: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    profile: 'https://api.github.com/user',
    scope: 'read:user user:email',
  },
};
export function providerName(value: string): Provider {
  if (value !== 'google' && value !== 'github')
    throw new UnauthorizedException({
      statusCode: 401,
      code: 'OAUTH_INVALID_PROVIDER',
      message: 'Unsupported sign-in provider.',
    });
  return value;
}
function providerFailure(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'OAUTH_PROVIDER_FAILED',
    message: 'The provider could not verify this sign-in.',
  });
}

/** Fixed vendor endpoints; credentials and provider access tokens never reach the browser. */
@Injectable()
export class OAuthProviders {
  constructor(
    private readonly config: ConfigService,
    @Inject(OAUTH_FETCH) private readonly http: typeof fetch,
  ) {}
  publicOrigin(): string {
    const value =
      this.config.get<string>('OAUTH_PUBLIC_URL') ||
      this.config.get<string>('APPURL');
    try {
      const url = new URL(value ?? '');
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !['', '/'].includes(url.pathname) ||
        (url.protocol !== 'https:' &&
          !(
            url.protocol === 'http:' &&
            ['localhost', '127.0.0.1'].includes(url.hostname)
          ))
      )
        throw new Error();
      return url.origin;
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'OAUTH_DISABLED',
        message: 'External sign-in is not configured.',
      });
    }
  }
  enabled(): Provider[] {
    return (['google', 'github'] as const).filter((name) => {
      try {
        this.settings(name);
        return true;
      } catch {
        return false;
      }
    });
  }
  settings(name: Provider): ProviderConfig {
    const prefix = `OAUTH_${name.toUpperCase()}`;
    const id =
        this.config.get<string>(`${prefix}_CLIENT_ID`) ||
        this.config.get<string>(`${name.toUpperCase()}_CLIENT_ID`),
      secret =
        this.config.get<string>(`${prefix}_CLIENT_SECRET`) ||
        this.config.get<string>(`${name.toUpperCase()}_CLIENT_SECRET`);
    if (!id?.trim() || !secret?.trim())
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'OAUTH_DISABLED',
        message: 'This sign-in provider is not configured.',
      });
    const callback = `${this.publicOrigin()}/api/v1/auth/oauth/${name}/callback`;
    const configured = this.config.get<string>(
      `${name.toUpperCase()}_CALLBACK_URL`,
    );
    if (configured && configured !== callback)
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'OAUTH_DISABLED',
        message:
          'The provider callback does not match the public application URL.',
      });
    return { id, secret, callback };
  }
  authorization(name: Provider, state: string, verifier: string): string {
    const config = this.settings(name),
      url = new URL(endpoints[name].authorize);
    url.search = new URLSearchParams({
      client_id: config.id,
      redirect_uri: config.callback,
      response_type: 'code',
      scope: endpoints[name].scope,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }
  async identity(
    name: Provider,
    code: string,
    verifier: string,
  ): Promise<ProviderIdentity> {
    const config = this.settings(name);
    try {
      const token = await this.json(endpoints[name].token, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: config.id,
          client_secret: config.secret,
          code,
          redirect_uri: config.callback,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }).toString(),
      });
      if (
        typeof token.access_token !== 'string' ||
        !token.access_token ||
        token.access_token.length > 8192 ||
        token.error
      )
        throw providerFailure();
      const headers = {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/json',
        'User-Agent': '42chess',
      };
      const profile = await this.json(endpoints[name].profile, { headers });
      const id = name === 'google' ? profile.sub : profile.id;
      if (
        (typeof id !== 'string' &&
          !(
            name === 'github' &&
            typeof id === 'number' &&
            Number.isSafeInteger(id)
          )) ||
        !String(id) ||
        String(id).length > 255
      )
        throw providerFailure();
      let email: unknown = null;
      if (name === 'google' && profile.email_verified === true)
        email = profile.email;
      if (name === 'github') {
        const emails = await this.json('https://api.github.com/user/emails', {
          headers,
        });
        if (!Array.isArray(emails)) throw providerFailure();
        email = emails.find(
          (e: any) => e?.primary === true && e?.verified === true,
        )?.email;
      }
      return {
        id: String(id),
        email:
          typeof email === 'string' && email.length <= 254 && isEmail(email)
            ? email.toLowerCase()
            : null,
      };
    } catch {
      throw providerFailure();
    }
  }
  private async json(url: string, init: RequestInit): Promise<any> {
    const response = await this.http(url, {
      ...init,
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) throw providerFailure();
    const text = await response.text();
    if (text.length > 1_048_576) throw providerFailure();
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object') throw providerFailure();
    return body;
  }
}
