import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { Order } from '../models/Order.js';
import { markPaid } from './order.controller.js';

type OrderDoc = InstanceType<typeof Order>;

interface RazorpayEvent {
  event: string;
  payload: {
    payment?: { entity: { id: string; order_id: string; status: string; error_description?: string } };
    order?: { entity: { id: string } };
  };
}

/**
 * Razorpay webhook (Dashboard → Webhooks → https://<api>/api/payments/razorpay/webhook,
 * events: payment.captured, order.paid, payment.failed). Confirms orders even if the
 * customer closed the browser before the checkout handler ran. Mounted with a raw body parser.
 */
export async function razorpayWebhook(req: Request, res: Response) {
  if (!env.razorpayWebhookSecret) return res.status(503).json({ success: false, message: 'Webhook secret not configured.' });

  const raw = req.body as Buffer;
  const signature = String(req.headers['x-razorpay-signature'] ?? '');
  const expected = createHmac('sha256', env.razorpayWebhookSecret).update(raw).digest('hex');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
  }

  const evt = JSON.parse(raw.toString('utf8')) as RazorpayEvent;
  const payment = evt.payload.payment?.entity;
  const razorpayOrderId = payment?.order_id ?? evt.payload.order?.entity.id;
  const order = razorpayOrderId ? ((await Order.findOne({ razorpayOrderId })) as OrderDoc | null) : null;

  if (order && payment) {
    if (evt.event === 'payment.captured' || evt.event === 'order.paid') {
      await markPaid(order, payment.id, 'webhook');
    } else if (evt.event === 'payment.failed' && order.paymentStatus === 'Pending') {
      order.paymentStatus = 'Failed';
      order.statusHistory.push({ status: order.status, at: new Date(), note: `Payment failed · ${payment.error_description ?? payment.id}` });
      await order.save();
    }
  }
  // Always 200 for a valid signature so Razorpay doesn't keep retrying events we don't track
  res.json({ success: true, handled: Boolean(order) });
}
