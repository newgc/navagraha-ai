import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController, MeController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService, OTP_POLICY } from './auth.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { WHATSAPP, type WhatsAppMessenger } from '../messaging/whatsapp.js';
import {
  ConsoleOtpSender,
  FileOtpSender,
  LogCopyOtpSender,
  WhatsAppOtpSender,
  OTP_SENDER,
  type OtpSender,
} from './otp-sender.js';

function otpSender(config: AppConfig, messenger: WhatsAppMessenger | null): OtpSender {
  if (config.OTP_SENDER === 'file') return new FileOtpSender(config.OTP_OUTBOX_FILE!);
  if (config.OTP_SENDER === 'console') return new ConsoleOtpSender();
  // Config refuses OTP_SENDER=whatsapp without the Hashwa settings, so the messenger exists.
  const whatsapp = new WhatsAppOtpSender(messenger!, OTP_POLICY.ttlSeconds / 60);
  // Staging keeps a copy in its log (the staging codes button); production never logs codes.
  return config.DEPLOY_ENV === 'staging' ? new LogCopyOtpSender(whatsapp) : whatsapp;
}

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    {
      provide: OTP_SENDER,
      useFactory: otpSender,
      inject: [APP_CONFIG, WHATSAPP],
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
