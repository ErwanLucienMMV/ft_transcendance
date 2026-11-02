import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Largest accepted avatar file, in bytes. nginx allows a little more for the multipart frame. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** Stored avatars are referred to as `avatars/<file>`, relative to the API base URL. */
export const AVATAR_PATH_PREFIX = 'avatars/';
/** `<owner uuid>-<content hash>.<ext>`: a new image always gets a new name, so caching is safe. */
export const AVATAR_FILE = /^[0-9a-f-]{36}-[0-9a-f]{16}\.(png|jpg|webp)$/;

export type AvatarType = 'png' | 'jpg' | 'webp';
export const AVATAR_CONTENT_TYPES: Record<AvatarType, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/** Reads the file signature: the declared type and the extension are never trusted. */
export function avatarType(content: Buffer): AvatarType | null {
  if (
    content.length >= 8 &&
    content
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (
    content.length >= 3 &&
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[2] === 0xff
  )
    return 'jpg';
  if (
    content.length >= 12 &&
    content.toString('latin1', 0, 4) === 'RIFF' &&
    content.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp';
  return null;
}

/** Avatars live on a volume of the API container (AVATAR_DIR, default ./uploads/avatars). */
@Injectable()
export class AvatarStorage {
  private readonly logger = new Logger(AvatarStorage.name);
  readonly directory = resolve(
    process.env.AVATAR_DIR ?? join(process.cwd(), 'uploads', 'avatars'),
  );

  /** Checks and writes the image, then returns its `avatars/<file>` reference. */
  async save(ownerId: string, content: Buffer): Promise<string> {
    if (content.length === 0 || content.length > AVATAR_MAX_BYTES)
      throw invalidAvatar('An avatar must be an image of at most 2 MB.');
    const type = avatarType(content);
    if (!type)
      throw invalidAvatar('An avatar must be a PNG, JPEG or WebP image.');
    const hash = createHash('sha256').update(content).digest('hex');
    const file = `${ownerId}-${hash.slice(0, 16)}.${type}`;
    await mkdir(this.directory, { recursive: true });
    // Written aside, then renamed: a reader never sees half an image.
    const partial = join(this.directory, `.${file}.partial`);
    await writeFile(partial, content, { mode: 0o644 });
    await rename(partial, join(this.directory, file));
    return AVATAR_PATH_PREFIX + file;
  }

  /** The stored file for a reference, or null for anything that is not an uploaded avatar. */
  path(reference: string | null): string | null {
    if (!reference?.startsWith(AVATAR_PATH_PREFIX)) return null;
    const file = reference.slice(AVATAR_PATH_PREFIX.length);
    return AVATAR_FILE.test(file) ? join(this.directory, file) : null;
  }

  /** Removes a replaced upload. External URLs (OAuth pictures) are left alone. */
  async remove(reference: string | null): Promise<void> {
    const path = this.path(reference);
    if (!path) return;
    try {
      await unlink(path);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.logger.warn(`Could not remove ${path}: ${String(error)}`);
    }
  }
}

function invalidAvatar(message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'INVALID_AVATAR',
    message,
  });
}
