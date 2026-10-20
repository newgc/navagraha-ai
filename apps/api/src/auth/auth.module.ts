import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController, MeController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { ConsoleOtpSender, OTP_SENDER } from './otp-sender.js';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    { provide: OTP_SENDER, useClass: ConsoleOtpSender },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
