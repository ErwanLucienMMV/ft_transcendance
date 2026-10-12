import { Injectable, Logger } from '@nestjs/common';
import { verify } from 'otplib';

// Accepts the previous and next 30 s period too, for clock drift between the
// phone and the server (the usual setting of authenticator apps).
const EPOCH_TOLERANCE_SECONDS = 30;

/** Checks the 6-digit codes of authenticator apps (RFC 6238, SHA-1, 30 s). */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);

  /**
   * Returns the time step the code belongs to, or null when it is wrong.
   * Steps up to `afterTimeStep` are refused: a code can only be used once.
   * A stored secret otplib rejects (e.g. too short) is logged and treated as
   * a wrong code rather than surfacing as a server error.
   */
  async verify(
    secret: string,
    code: string,
    afterTimeStep: number | null,
  ): Promise<number | null> {
    try {
      const result = await verify({
        secret,
        token: code,
        epochTolerance: EPOCH_TOLERANCE_SECONDS,
        afterTimeStep: afterTimeStep ?? undefined,
      });
      // `verify` also covers HOTP in its types; only TOTP results carry a step.
      return result.valid && 'timeStep' in result ? result.timeStep : null;
    } catch (error: unknown) {
      this.logger.warn(`TOTP verification failed: ${String(error)}`);
      return null;
    }
  }
}
