import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AVATAR_MAX_BYTES,
  AvatarStorage,
  avatarType,
} from './avatar-storage.js';

const owner = '6f1c3c6e-8e4a-4b8e-9c55-0d1b2c3d4e5f';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x10, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);

describe('Avatar storage', () => {
  let directory: string;
  let storage: AvatarStorage;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'avatars-'));
    vi.stubEnv('AVATAR_DIR', directory);
    storage = new AvatarStorage();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it('recognizes images by their signature, not their name', () => {
    expect(avatarType(png)).toBe('png');
    expect(avatarType(jpeg)).toBe('jpg');
    expect(avatarType(webp)).toBe('webp');
    expect(
      avatarType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
    expect(avatarType(Buffer.from('GIF89a'))).toBeNull();
    expect(avatarType(Buffer.alloc(0))).toBeNull();
  });

  it('stores an image under a name derived from its owner and content', async () => {
    const reference = await storage.save(owner, png);
    expect(reference).toMatch(
      new RegExp(`^avatars/${owner}-[0-9a-f]{16}\\.png$`),
    );
    expect(await storage.save(owner, png)).toBe(reference);
    expect(await storage.save(owner, jpeg)).not.toBe(reference);
    const path = storage.path(reference)!;
    expect(await readFile(path)).toEqual(png);
    // No partial file is left behind.
    expect(
      (await readdir(directory)).filter((file) => file.startsWith('.')),
    ).toEqual([]);
  });

  it('refuses other formats, empty files and files over 2 MB', async () => {
    for (const content of [
      Buffer.from('<svg/>'),
      Buffer.alloc(0),
      Buffer.concat([png, Buffer.alloc(AVATAR_MAX_BYTES)]),
    ])
      await expect(storage.save(owner, content)).rejects.toMatchObject({
        response: { code: 'INVALID_AVATAR' },
      });
    expect(await readdir(directory)).toEqual([]);
  });

  it('only resolves and removes its own uploads', async () => {
    const reference = await storage.save(owner, webp);
    expect(storage.path('https://example.com/a.png')).toBeNull();
    expect(storage.path('avatars/../../etc/passwd')).toBeNull();
    expect(storage.path(null)).toBeNull();
    await storage.remove('https://example.com/a.png');
    await storage.remove(reference);
    await storage.remove(reference);
    expect(await readdir(directory)).toEqual([]);
  });
});
