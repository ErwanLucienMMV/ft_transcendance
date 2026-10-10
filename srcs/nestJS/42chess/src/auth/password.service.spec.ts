import { Test } from '@nestjs/testing';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  let passwords: PasswordService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PasswordService],
    }).compile();

    passwords = moduleRef.get(PasswordService);
  });

  it('hashes with argon2id and never returns the plain password', async () => {
    const hash = await passwords.hash('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('salts every hash, so the same password gives different hashes', async () => {
    const first = await passwords.hash('same-password');
    const second = await passwords.hash('same-password');

    expect(first).not.toBe(second);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await passwords.hash('s3cret-password');

    await expect(passwords.verify(hash, 's3cret-password')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'S3cret-password')).resolves.toBe(
      false,
    );
  });

  it('returns false instead of throwing on a malformed stored hash', async () => {
    await expect(passwords.verify('not-a-hash', 'whatever')).resolves.toBe(
      false,
    );
  });
});
