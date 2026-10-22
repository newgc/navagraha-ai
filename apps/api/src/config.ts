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
     * How sign-in codes are delivered (D-11): `whatsapp` sends them through Hashwa (the only
     * choice in production); `console` prints them (allowed on staging); `file` appends them to
     * OTP_OUTBOX_FILE for browser tests.
     */
    OTP_SENDER: z.enum(['console', 'file', 'whatsapp']).default('console'),
    OTP_OUTBOX_FILE: z.string().min(1).optional(),
    /** Hashwa WhatsApp API (D-11). The secret needs the "wa_send" permission. */
    HASHWA_API_URL: z.url().default('https://eco.hashwa.in/api'),
    // Keys pasted into GitHub secrets often carry a stray space or line break; trim them.
    WHATSAPP_API_SECRET: z.string().trim().min(1).optional(),
    /** Unique ID of the linked WhatsApp account that sends the codes (Hashwa dashboard). */
    WHATSAPP_ACCOUNT: z.string().trim().min(1).optional(),
    /**
     * Phone numbers (comma-separated) that are made System Admin and Operations Manager at
     * startup, so the first admin can sign in on a server with no command line (Lightsail).
     * Idempotent and audited; manage everyone else on the Team screen.
     */
    BOOTSTRAP_ADMIN_PHONES: z.string().optional(),
    /** Payment gateway for payment links (D-11). `none` hides the "Send payment link" action. */
    PAYMENT_GATEWAY: z.enum(['none', 'razorpay', 'cashfree']).default('none'),
    /** rzp_test_… takes no real money; only DEPLOY_ENV=production may use rzp_live_… keys. */
    RAZORPAY_KEY_ID: z.string().trim().min(1).optional(),
    RAZORPAY_KEY_SECRET: z.string().trim().min(1).optional(),
    /** Chosen when adding the webhook in the Razorpay dashboard; signs its webhooks. */
    RAZORPAY_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
    /** `sandbox` takes no real money; only DEPLOY_ENV=production may use `production`. */
    CASHFREE_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
    CASHFREE_CLIENT_ID: z.string().trim().min(1).optional(),
    /** Also the key that signs Cashfree's webhooks. */
    CASHFREE_CLIENT_SECRET: z.string().trim().min(1).optional(),
    CASHFREE_API_VERSION: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .default('2026-01-01'),
    /** Public address of the website, e.g. https://navagrahayathra.in (link return page). */
    PUBLIC_WEB_URL: z.url().optional(),
    /**
     * How long a payment link stays payable. Payment timing is open business policy (D-06,
     * FS §31 "payment timing unspecified"); this is the setting until it is decided.
     */
    PAYMENT_LINK_EXPIRY_HOURS: z.coerce.number().int().min(1).max(720).default(48),
  })
  .superRefine((env, ctx) => {
    if (env.OTP_SENDER === 'file' && !env.OTP_OUTBOX_FILE) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_OUTBOX_FILE'],
        message: 'is required for the file sender',
      });
    }
    if (env.OTP_SENDER === 'whatsapp') {
      for (const key of ['WHATSAPP_API_SECRET', 'WHATSAPP_ACCOUNT'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'is required for WhatsApp codes' });
        }
      }
    }
    if (env.PAYMENT_GATEWAY === 'razorpay') {
      for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'is required for Razorpay' });
        }
      }
      const live = env.RAZORPAY_KEY_ID?.startsWith('rzp_live_');
      const test = env.RAZORPAY_KEY_ID?.startsWith('rzp_test_');
      // Real money only on the production deployment, and never test money there.
      if (env.RAZORPAY_KEY_ID && !live && !test) {
        ctx.addIssue({
          code: 'custom',
          path: ['RAZORPAY_KEY_ID'],
          message: 'should start with rzp_test_ or rzp_live_',
        });
      }
      if (live && env.DEPLOY_ENV !== 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['RAZORPAY_KEY_ID'],
          message: 'live keys may only be used when DEPLOY_ENV is production',
        });
      }
      if (test && env.DEPLOY_ENV === 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['RAZORPAY_KEY_ID'],
          message: 'the production deployment must use live keys',
        });
      }
    }
    if (env.PAYMENT_GATEWAY === 'cashfree') {
      for (const key of ['CASHFREE_CLIENT_ID', 'CASHFREE_CLIENT_SECRET'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'is required for Cashfree' });
        }
      }
      // Real money only on the production deployment, and never test money there.
      if (env.CASHFREE_ENV === 'production' && env.DEPLOY_ENV !== 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['CASHFREE_ENV'],
          message: 'production keys may only be used when DEPLOY_ENV is production',
        });
      }
      if (env.CASHFREE_ENV === 'sandbox' && env.DEPLOY_ENV === 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['CASHFREE_ENV'],
          message: 'the production deployment must use production keys',
        });
      }
    }
    const realServer = env.NODE_ENV === 'production' || env.DEPLOY_ENV !== 'local';
    if (!realServer) return;
    const allowed =
      env.OTP_SENDER === 'whatsapp' ||
      (env.DEPLOY_ENV === 'staging' && env.OTP_SENDER === 'console');
    if (!allowed) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_SENDER'],
        message:
          env.DEPLOY_ENV === 'staging'
            ? `${env.OTP_SENDER} cannot be used on a server; use whatsapp or console on staging`
            : `${env.OTP_SENDER} cannot be used in production; use whatsapp (D-11)`,
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
