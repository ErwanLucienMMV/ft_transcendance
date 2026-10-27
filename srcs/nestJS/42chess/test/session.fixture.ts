import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { SessionService } from '../dist/auth/session.service.js';
import { User } from '../dist/users/user.entity.js';

export async function sessionToken(
  app: INestApplication,
  userId: string,
  expiresIn?: number,
): Promise<string> {
  const user = await app
    .get(DataSource)
    .getRepository(User)
    .findOneByOrFail({ id: userId });
  const { accessToken } = await app.get(SessionService).issue(user);
  if (expiresIn === undefined) return accessToken;
  const jwt = new JwtService();
  const { iat: _iat, exp: _exp, ...claims } =
    jwt.decode<Record<string, unknown>>(accessToken);
  return jwt.signAsync(claims, { secret: process.env.JWT_SECRET, expiresIn });
}
