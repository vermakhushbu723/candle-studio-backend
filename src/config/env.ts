import 'dotenv/config';

const required = (key: string) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing environment variable ${key}`);
  return v;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 5050),
  mongoUri: required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@candledust.in',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'Candle@2026',
  // Razorpay — online payments are disabled until both are set
  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  // Phone OTP login. Dev mode logs the OTP and returns it in the API response (never enable in production).
  otpDevMode: (process.env.OTP_DEV_MODE ?? 'true') === 'true',
  // Google sign-in — the OAuth Web client ID from Google Cloud Console
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  // Public site URL used in links inside notifications and emails
  siteUrl: process.env.SITE_URL ?? 'https://jyotessa.com',
  // Google Business Profile "write a review" link — used in the Delivered email/push
  googleReviewUrl: process.env.GOOGLE_REVIEW_URL ?? 'https://g.page/r/CQ2T_G0wSr7nECE/review',
  // Firebase Cloud Messaging (push). Service-account JSON, base64-encoded. Push is disabled until set.
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ?? '',
  // Email (SMTP). Email is disabled until SMTP_HOST is set.
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: (process.env.SMTP_SECURE ?? 'false') === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },
  mailFrom: process.env.MAIL_FROM ?? 'Jyotessa <no-reply@jyotessa.com>',
  // Where "new order" alerts for the team are emailed (optional)
  adminNotifyEmail: process.env.ADMIN_NOTIFY_EMAIL ?? '',
};
