import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface RealtimePrincipal {
  userId: string;
  expiresAt: number;
  validate?: () => Promise<void>;
}

/** SCRUM-178 integration seam: implementations MUST verify JWT and user eligibility. */
export abstract class RealtimeAuthenticator {
  abstract authenticate(accessToken: string): Promise<RealtimePrincipal>;
}

@Injectable()
export class UnavailableRealtimeAuthenticator extends RealtimeAuthenticator {
  async authenticate(_accessToken: string): Promise<RealtimePrincipal> {
    throw new ServiceUnavailableException({
      statusCode: 503,
      code: 'AUTH_UNAVAILABLE',
      message: 'Realtime authentication is not available yet.',
    });
  }
}
