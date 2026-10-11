import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
import { env } from './env.js';

export const razorpayEnabled = () => Boolean(env.razorpayKeyId && env.razorpayKeySecret);

let client: Razorpay | null = null;
export function razorpay() {
  if (!razorpayEnabled()) return null;
  client ??= new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
  return client;
}

/** Checkout success handler signature: HMAC-SHA256(order_id|payment_id, key_secret). */
export function isValidPaymentSignature(razorpayOrderId: string, paymentId: string, signature: string) {
  const expected = createHmac('sha256', env.razorpayKeySecret).update(`${razorpayOrderId}|${paymentId}`).digest('hex');
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
