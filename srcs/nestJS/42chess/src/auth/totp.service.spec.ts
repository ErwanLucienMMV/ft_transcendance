import { Logger } from '@nestjs/common';
import { generate, generateSecret } from 'otplib';
import { TotpService } from './totp.service.js';

describe('TotpService', () => {
  const totp = new TotpService();
  const secret = generateSecret();

  it('accepts the current code and returns its time step', async () => {
    const step = await totp.verify(secret, await generate({ secret }), null);

    expect(step).toBe(Math.floor(Date.now() / 1000 / 30));
  });

  it('accepts the code of the previous period (clock drift)', async () => {
    const code = await generate({ secret, epoch: Date.now() / 1000 - 30 });

    await expect(totp.verify(secret, code, null)).resolves.not.toBeNull();
  });

  it('rejects a code from another secret', async () => {
    const code = await generate({ secret: generateSecret() });

    await expect(totp.verify(secret, code, null)).resolves.toBeNull();
  });

  it('rejects a code whose time step was already used', async () => {
    const code = await generate({ secret });
    const step = (await totp.verify(secret, code, null)) as number;

    await expect(totp.verify(secret, code, step)).resolves.toBeNull();
  });

  it('treats a secret otplib refuses as a wrong code', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    // 10 bytes: below the 16 bytes otplib requires.
    await expect(
      totp.verify('JBSWY3DPEHPK3PXP', '123456', null),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('16 bytes'));
  });
});
