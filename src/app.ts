import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middlewares/error.js';
import adminRoutes from './routes/admin.routes.js';
import publicRoutes from './routes/public.routes.js';
import { razorpayWebhook } from './controllers/webhook.controller.js';
import { asyncHandler } from './utils/http.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      credentials: true,
    }),
  );
  // Razorpay signs the exact raw bytes, so the webhook gets the body before JSON parsing
  app.post('/api/payments/razorpay/webhook', express.raw({ type: '*/*', limit: '1mb' }), asyncHandler(razorpayWebhook));
  app.use(express.json({ limit: '1mb' }));
  if (env.nodeEnv !== 'test') app.use(morgan('dev'));

  app.get('/api/health', (_req, res) =>
    res.json({ success: true, status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }),
  );
  app.use('/api/admin', adminRoutes);
  app.use('/api', publicRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
