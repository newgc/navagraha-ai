import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { parseBody } from '../common/zod.js';
import { AuthService } from './auth.service.js';
import type { AuthContext, AuthedRequest } from './auth.types.js';
import { CurrentAuth, Public } from './decorators.js';

const OtpRequest = z.object({ phone: z.string().min(1).max(32) });
const OtpVerify = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/, 'must be 6 digits'),
});

const meta = (req: AuthedRequest) => ({
  correlationId: req.correlationId,
  ip: req.ip,
  userAgent: req.header('user-agent'),
});

/** FS §32: POST /auth/otp/request, POST /auth/otp/verify. */
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(202)
  request(@Body() body: unknown, @Req() req: AuthedRequest) {
    return this.auth.requestOtp(parseBody(OtpRequest, body).phone, meta(req));
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() body: unknown, @Req() req: AuthedRequest) {
    const { challengeId, code } = parseBody(OtpVerify, body);
    return this.auth.verifyOtp(challengeId, code, meta(req));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext, @Req() req: AuthedRequest) {
    await this.auth.logout(auth, req.correlationId);
  }
}

@Controller('me')
export class MeController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth);
  }
}
