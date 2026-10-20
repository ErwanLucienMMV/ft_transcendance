import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/access-token.guard.js';
import { ownProfile, publicProfile } from './user-profile.js';
import { PresenceService } from '../presence/presence.service.js';
import { UsersService } from './users.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

@Controller('v1/users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly presence: PresenceService,
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

  @Get(':id')
  async profile(@Param('id', new ParseUUIDPipe()) id: string) {
    return publicProfile(
      await this.users.publicById(id),
      this.presence.isOnline(id),
    );
  }
}
