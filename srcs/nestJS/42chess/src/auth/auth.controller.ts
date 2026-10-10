import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { RegisterResponse } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Creates a local account. Responds 201 with the public user. */
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<RegisterResponse> {
    return this.auth.register(dto);
  }
}
