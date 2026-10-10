import { Injectable, Logger } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

/**
 * Hashes and verifies user passwords with Argon2id (OWASP's first choice for
 * password storage). The salt and parameters are embedded in the returned
 * hash, so only that string needs to be stored in `users.passwordHash`.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  hash(password: string): Promise<string> {
    return hash(password, { type: argon2id });
  }

  /**
   * Returns false for a wrong password. A malformed stored hash is logged and
   * treated as a failed login rather than surfacing as a server error.
   */
  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch (error: unknown) {
      this.logger.warn(
        `Password verification failed on a malformed hash: ${String(error)}`,
      );
      return false;
    }
  }
}
