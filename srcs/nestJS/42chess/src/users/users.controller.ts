import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AVATAR_MAX_BYTES, AvatarStorage } from './avatar-storage.js';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/access-token.guard.js';
import { ownProfile, publicProfile } from './user-profile.js';
import { PresenceService } from '../presence/presence.service.js';
import { UsersService } from './users.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { SearchUsersDto } from './dto/search-users.dto.js';

@Controller('v1/users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly presence: PresenceService,
    private readonly avatars: AvatarStorage,
  ) {}

  @Get('me')
  @UseGuards(AccessTokenGuard)
  async me(@Req() request: AuthenticatedRequest) {
    return ownProfile(await this.users.requireById(request.user.id));
  }

  @Patch('me')
  @UseGuards(AccessTokenGuard)
  async updateMe(
    @Req() request: AuthenticatedRequest,
    @Body() input: UpdateProfileDto,
  ) {
    return ownProfile(await this.users.updateProfile(request.user.id, input));
  }

  /** multipart/form-data with one `avatar` file: PNG, JPEG or WebP, 2 MB at most. */
  @Post('me/avatar')
  @UseGuards(AccessTokenGuard)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: { fileSize: AVATAR_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  async uploadAvatar(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    if (!file)
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_AVATAR',
        message: 'Send the image in an "avatar" file field.',
      });
    const reference = await this.avatars.save(request.user.id, file.buffer);
    const { user, previous } = await this.users.setAvatar(
      request.user.id,
      reference,
    );
    if (previous !== reference) await this.avatars.remove(previous);
    return ownProfile(user);
  }

  /** Back to the default avatar drawn from the username. */
  @Delete('me/avatar')
  @UseGuards(AccessTokenGuard)
  async deleteAvatar(@Req() request: AuthenticatedRequest) {
    const { user, previous } = await this.users.setAvatar(
      request.user.id,
      null,
    );
    await this.avatars.remove(previous);
    return ownProfile(user);
  }

  @Get('search')
  async search(@Query() query: SearchUsersDto) {
    const users = await this.users.searchByUsername(query.q, query);
    return {
      users: users.map((user) => ({
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
        elo: user.elo,
        online: this.presence.isOnline(user.id),
      })),
    };
  }

  @Get(':id')
  async profile(@Param('id', new ParseUUIDPipe()) id: string) {
    return publicProfile(
      await this.users.publicById(id),
      this.presence.isOnline(id),
    );
  }
}
