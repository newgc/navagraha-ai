import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /**
     * Which deployment this is. `staging` is a real server used for testing (the pilot test
     * site): it runs production builds but may print sign-in codes to the server log until an
     * SMS provider is chosen (D-11). `production` never may.
     */
    DEPLOY_ENV: z.enum(['local', 'staging', 'production']).default('local'),
    /** The API is only reached by the web app on the same server, so it listens on loopback. */
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
    /** Key for OTP code HMACs. Generate with: openssl rand -base64 48 */
    AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /**
     * How sign-in codes are delivered until an SMS provider is chosen (D-11): `console` prints
     * them (allowed on staging); `file` appends them to OTP_OUTBOX_FILE for browser tests.
     * Neither is allowed in production.
     */
    OTP_SENDER: z.enum(['console', 'file']).default('console'),
    OTP_OUTBOX_FILE: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.OTP_SENDER === 'file' && !env.OTP_OUTBOX_FILE) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_OUTBOX_FILE'],
        message: 'is required for the file sender',
      });
    }
    const realServer = env.NODE_ENV === 'production' || env.DEPLOY_ENV !== 'local';
    if (!realServer) return;
    const allowed = env.DEPLOY_ENV === 'staging' && env.OTP_SENDER === 'console';
    if (!allowed) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_SENDER'],
        message:
          env.DEPLOY_ENV === 'staging'
            ? `${env.OTP_SENDER} cannot be used on a server; use console on staging`
            : `${env.OTP_SENDER} cannot be used in production; configure an SMS provider (D-11)`,
      });
    }
    if (/change-me/i.test(env.AUTH_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['AUTH_SECRET'], message: 'is the example value' });
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

/** Injection token for the validated configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/** Fails fast at startup with every invalid variable listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration — ${issues}`);
  }
  return parsed.data;
}
