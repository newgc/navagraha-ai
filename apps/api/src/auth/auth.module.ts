import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController, MeController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { ConsoleOtpSender, FileOtpSender, OTP_SENDER } from './otp-sender.js';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    {
      provide: OTP_SENDER,
      useFactory: (config: AppConfig) =>
        config.OTP_SENDER === 'file'
          ? new FileOtpSender(config.OTP_OUTBOX_FILE!)
          : new ConsoleOtpSender(),
      inject: [APP_CONFIG],
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
