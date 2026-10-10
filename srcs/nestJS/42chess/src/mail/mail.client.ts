import { Injectable, Logger } from '@nestjs/common';

const DEFAULT_MAIL_SERVICE_URL = 'http://forgemail:3002';
const MAIL_TIMEOUT_MS = 5000;

/** forgemail could not be reached or refused to send the email. */
export class MailUnavailableError extends Error {
  constructor() {
    super('Mail service unavailable');
    this.name = 'MailUnavailableError';
  }
}

/**
 * Talks to the forgemail container, which owns the SMTP credentials and the
 * templates. Only reachable on the internal Docker network.
 */
@Injectable()
export class MailClient {
  private readonly logger = new Logger(MailClient.name);
  private readonly baseUrl =
    process.env.MAIL_SERVICE_URL ?? DEFAULT_MAIL_SERVICE_URL;

  async sendEmailVerification(
    to: string,
    username: string,
    token: string,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/mails/email-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, username, token }),
        signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      this.logger.error(`forgemail unreachable: ${String(error)}`);
      throw new MailUnavailableError();
    }
    if (!response.ok) {
      this.logger.error(`forgemail answered ${response.status}`);
      throw new MailUnavailableError();
    }
  }
}
