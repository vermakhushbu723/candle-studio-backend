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
};
