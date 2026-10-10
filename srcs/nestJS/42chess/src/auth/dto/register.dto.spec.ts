import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto.js';

const VALID = {
  username: 'alice_42',
  email: 'alice@example.com',
  password: 'correct-horse',
};

async function invalidFields(body: Record<string, unknown>) {
  const dto = plainToInstance(RegisterDto, body);
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe('RegisterDto', () => {
  it('accepts a valid body', async () => {
    await expect(invalidFields(VALID)).resolves.toEqual([]);
  });

  it('normalizes the email to lowercase without spaces', () => {
    const dto = plainToInstance(RegisterDto, {
      ...VALID,
      email: '  Alice@Example.COM ',
    });

    expect(dto.email).toBe('alice@example.com');
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(33)],
    ['with a space', 'alice bob'],
    ['with a special character', 'alice!'],
  ])('rejects a username %s', async (_case, username) => {
    await expect(invalidFields({ ...VALID, username })).resolves.toEqual([
      'username',
    ]);
  });

  it.each([
    ['not an email', 'alice'],
    ['too long', `${'a'.repeat(250)}@x.io`],
  ])('rejects an email %s', async (_case, email) => {
    await expect(invalidFields({ ...VALID, email })).resolves.toEqual([
      'email',
    ]);
  });

  it.each([
    ['too short', 'short'],
    ['too long', 'a'.repeat(129)],
  ])('rejects a password %s', async (_case, password) => {
    await expect(invalidFields({ ...VALID, password })).resolves.toEqual([
      'password',
    ]);
  });

  it('rejects missing fields and non-string values', async () => {
    await expect(invalidFields({ username: 42 })).resolves.toEqual([
      'username',
      'email',
      'password',
    ]);
  });
});
