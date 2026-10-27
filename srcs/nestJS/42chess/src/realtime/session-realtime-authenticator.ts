import { Injectable } from '@nestjs/common';
import { SessionService } from '../auth/session.service.js';
import { RealtimeAuthenticator } from './realtime-authenticator.js';

@Injectable()
export class SessionRealtimeAuthenticator extends RealtimeAuthenticator {
  constructor(private readonly sessions: SessionService) {
    super();
  }
  async authenticate(token: string) {
    const principal = await this.sessions.authenticate(token);
    return {
      userId: principal.user.id,
      expiresAt: principal.expiresAt,
      validate: async () => {
        await this.sessions.authenticate(token);
      },
    };
  }
}
