import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
    /** Key for OTP code HMACs. Generate with: openssl rand -base64 48 */
    AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /**
     * How sign-in codes are delivered until an SMS provider is chosen (D-11): `console` prints
     * them; `file` appends them to OTP_OUTBOX_FILE for browser tests. Both are refused in production.
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
    if (env.NODE_ENV !== 'production') return;
    if (env.OTP_SENDER === 'console' || env.OTP_SENDER === 'file') {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_SENDER'],
        message: `${env.OTP_SENDER} cannot be used in production; configure an SMS provider (D-11)`,
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
