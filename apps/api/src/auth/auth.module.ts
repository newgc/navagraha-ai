import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController, MeController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService, OTP_POLICY } from './auth.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import {
  ConsoleOtpSender,
  FileOtpSender,
  HashwaWhatsAppOtpSender,
  LogCopyOtpSender,
  OTP_SENDER,
  type OtpSender,
} from './otp-sender.js';

function otpSender(config: AppConfig): OtpSender {
  if (config.OTP_SENDER === 'file') return new FileOtpSender(config.OTP_OUTBOX_FILE!);
  if (config.OTP_SENDER === 'console') return new ConsoleOtpSender();
  const whatsapp = new HashwaWhatsAppOtpSender({
    apiUrl: config.HASHWA_API_URL,
    secret: config.WHATSAPP_API_SECRET!,
    account: config.WHATSAPP_ACCOUNT!,
    expiresInMinutes: OTP_POLICY.ttlSeconds / 60,
  });
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
      inject: [APP_CONFIG],
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
