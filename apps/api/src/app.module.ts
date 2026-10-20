import { Global, Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { APP_CONFIG, loadConfig } from './config.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';
import { TemplesController } from './temples/temples.controller.js';
import { TemplesService } from './temples/temples.service.js';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
class ConfigModule {}

/**
 * Modular monolith root. Domain modules (Identity, Traveller, Temple, Itinerary, Quote,
 * Booking, Payment, Fulfilment, Trip, Notifications, AI, Audit — FS §2.2) are added here
 * as they are built.
 */
@Module({
  imports: [ConfigModule, DbModule, AuditModule, AuthModule, BookingsModule],
  controllers: [HealthController, TemplesController],
  providers: [TemplesService],
})
export class AppModule {}
