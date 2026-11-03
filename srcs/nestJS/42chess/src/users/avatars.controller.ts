import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import {
  AVATAR_CONTENT_TYPES,
  AVATAR_FILE,
  AVATAR_PATH_PREFIX,
  AvatarStorage,
} from './avatar-storage.js';
import type { AvatarType } from './avatar-storage.js';

/** Serves uploaded avatars. Names change with the content, so they are cached for a year. */
@Controller('v1/avatars')
@SkipThrottle()
export class AvatarsController {
  constructor(private readonly storage: AvatarStorage) {}

  @Get(':file')
  serve(@Param('file') file: string, @Res() response: Response): void {
    const path = this.storage.path(AVATAR_PATH_PREFIX + file);
    if (!path || !AVATAR_FILE.test(file)) throw notFound();
    const type = file.slice(file.lastIndexOf('.') + 1) as AvatarType;
    response.setHeader('Content-Type', AVATAR_CONTENT_TYPES[type]);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    response.sendFile(path, { headers: {} }, (error) => {
      if (error && !response.headersSent)
        response.status(404).json({
          statusCode: 404,
          code: 'AVATAR_NOT_FOUND',
          message: 'Avatar not found.',
        });
    });
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    code: 'AVATAR_NOT_FOUND',
    message: 'Avatar not found.',
  });
}
