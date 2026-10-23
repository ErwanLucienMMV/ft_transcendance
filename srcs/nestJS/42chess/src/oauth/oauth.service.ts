import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { User } from '../users/user.entity.js';
import { AuthSession } from '../auth/auth-session.entity.js';
import { AuthService } from '../auth/auth.service.js';
import { OauthAccount } from './oauth-accounts.entity.js';
import { OAuthFlow } from './oauth-flow.entity.js';
import { OAuthProviders } from './oauth-provider.js';
import type { Provider, ProviderIdentity } from './oauth-provider.js';
import type { SessionPrincipal } from '../auth/session.service.js';

const opaque = () => randomBytes(32).toString('base64url');
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function invalidFlow() {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'OAUTH_INVALID_FLOW',
    message: 'This sign-in expired or belongs to another browser. Start again.',
  });
}
function conflict(code: string, message: string) {
  return new ConflictException({ statusCode: 409, code, message });
}

@Injectable()
export class OAuthService {
  constructor(
    private readonly source: DataSource,
    private readonly providers: OAuthProviders,
    private readonly auth: AuthService,
  ) {}
  async start(provider: Provider, principal?: SessionPrincipal) {
    this.providers.settings(provider);
    const state = opaque(),
      browser = opaque(),
      verifier = opaque();
    const authorizationUrl = this.providers.authorization(
      provider,
      state,
      verifier,
    );
    await this.source
      .getRepository(OAuthFlow)
      .createQueryBuilder()
      .delete()
      .where('"expiresAt" <= now()')
      .execute();
    await this.source
      .getRepository(OAuthFlow)
      .insert({
        id: hash(state),
        browserHash: hash(browser),
        purpose: 'authorize',
        provider,
        verifier,
        userId: principal?.user.id ?? null,
        sessionId: principal?.sessionId ?? null,
        expiresAt: new Date(Date.now() + 300000),
      });
    return { authorizationUrl, browser };
  }
  async callback(
    provider: Provider,
    state: string,
    browser: string,
    code: string,
  ) {
    const flow = await this.consume(state, browser, 'authorize', provider);
    if (!code || code.length > 4096 || !flow.verifier) throw invalidFlow();
    const identity = await this.providers.identity(
      provider,
      code,
      flow.verifier,
    );
    const user = await this.account(provider, identity, flow);
    const handoff = opaque();
    await this.source
      .getRepository(OAuthFlow)
      .insert({
        id: hash(handoff),
        browserHash: hash(browser),
        purpose: 'handoff',
        provider,
        verifier: null,
        userId: user.id,
        sessionId: null,
        expiresAt: new Date(Date.now() + 60000),
      });
    return handoff;
  }
  async exchange(handoff: string, browser: string) {
    const flow = await this.consume(handoff, browser, 'handoff');
    const user = await this.source
      .getRepository(User)
      .findOneBy({ id: flow.userId! });
    if (!user?.emailVerifiedAt) throw invalidFlow();
    return this.auth.completeLogin(user);
  }
  async accounts(userId: string) {
    const rows = await this.source
      .getRepository(OauthAccount)
      .findBy({ userId });
    return { providers: rows.map((row) => row.provider) };
  }
  async unlink(provider: Provider, userId: string): Promise<void> {
    await this.source.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.id = :id', { id: userId })
        .setLock('pessimistic_write')
        .getOneOrFail();
      const accounts = await manager
        .getRepository(OauthAccount)
        .findBy({ userId });
      if (!accounts.some((a) => a.provider === provider)) return;
      if (!user.passwordHash && !accounts.some((a) => a.provider !== provider))
        throw conflict(
          'OAUTH_LAST_LOGIN_METHOD',
          'Add another sign-in method before removing this provider.',
        );
      await manager.getRepository(OauthAccount).delete({ userId, provider });
    });
  }
  private async account(
    provider: Provider,
    identity: ProviderIdentity,
    flow: OAuthFlow,
  ): Promise<User> {
    try {
      return await this.source.transaction(async (manager) => {
        // Serializes identity creation across simultaneous callbacks without trusting email.
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`oauth:${provider}:${identity.id}`],
        );
        const accounts = manager.getRepository(OauthAccount);
        const existing = await accounts.findOneBy({
          provider,
          providerUserId: identity.id,
        });
        if (flow.userId) {
          const user = await manager
            .getRepository(User)
            .findOne({
              where: { id: flow.userId },
              lock: { mode: 'pessimistic_write' },
            });
          const session = await manager
            .getRepository(AuthSession)
            .findOneBy({
              id: flow.sessionId!,
              userId: flow.userId,
              revokedAt: IsNull(),
              expiresAt: MoreThan(new Date()),
            });
          if (!user?.emailVerifiedAt || !session) throw invalidFlow();
          if (existing && existing.userId !== user.id)
            throw conflict(
              'OAUTH_ALREADY_LINKED',
              'This provider identity belongs to another account.',
            );
          if (!existing)
            await accounts.insert({
              provider,
              providerUserId: identity.id,
              userId: user.id,
            });
          return user;
        }
        if (existing) {
          const user = await manager
            .getRepository(User)
            .findOneByOrFail({ id: existing.userId });
          if (!user.emailVerifiedAt) throw invalidFlow();
          return user;
        }
        if (
          identity.email &&
          (await manager
            .getRepository(User)
            .existsBy({ email: identity.email }))
        )
          throw conflict(
            'OAUTH_EMAIL_IN_USE',
            'Sign in to your existing account, then link this provider from your session page.',
          );
        const user = await manager
          .getRepository(User)
          .save(
            manager
              .getRepository(User)
              .create({
                username: `${provider}_${randomBytes(10).toString('hex')}`,
                email: identity.email,
                emailVerifiedAt: new Date(),
                passwordHash: null,
              }),
          );
        await accounts.insert({
          provider,
          providerUserId: identity.id,
          userId: user.id,
        });
        return user;
      });
    } catch (error) {
      if ((error as any)?.driverError?.code === '23505')
        throw conflict(
          'OAUTH_ACCOUNT_CONFLICT',
          'This identity or email is already in use. Sign in to link your account.',
        );
      throw error;
    }
  }
  private async consume(
    value: string,
    browser: string,
    purpose: 'authorize' | 'handoff',
    provider?: Provider,
  ): Promise<OAuthFlow> {
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(value ?? '') ||
      !/^[A-Za-z0-9_-]{43}$/.test(browser ?? '')
    )
      throw invalidFlow();
    const result = await this.source
      .getRepository(OAuthFlow)
      .createQueryBuilder()
      .delete()
      .where(
        'id = :id AND "browserHash" = :browser AND purpose = :purpose AND "expiresAt" > now()',
        { id: hash(value), browser: hash(browser), purpose },
      )
      .andWhere(provider ? 'provider = :provider' : 'true', { provider })
      .returning('*')
      .execute();
    if (result.raw.length !== 1) throw invalidFlow();
    return result.raw[0] as OAuthFlow;
  }
}
