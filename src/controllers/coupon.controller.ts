import type { Request, Response } from 'express';
import { Coupon } from '../models/Engagement.js';
import { ApiError } from '../utils/http.js';

type CouponDoc = InstanceType<typeof Coupon>;

/** Returns the discount for a subtotal, or throws a customer-friendly error. */
export async function evaluateCoupon(code: string, subtotal: number) {
  const coupon = (await Coupon.findOne({ code: code.trim().toUpperCase() })) as CouponDoc | null;
  if (!coupon || !coupon.isActive) throw new ApiError(404, 'That code is not valid');
  if (coupon.expiry < new Date()) throw new ApiError(400, 'This coupon has expired.');
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) throw new ApiError(400, 'This coupon has reached its usage limit.');
  if (subtotal < coupon.minOrder) throw new ApiError(400, `Add items worth ₹${coupon.minOrder - subtotal} more to use ${coupon.code}.`);
  return { coupon, discount: discountFor(coupon, subtotal) };
}

export function discountFor(c: { type: string; value: number; maxDiscount?: number | null }, subtotal: number) {
  let discount = c.type === 'percent' ? Math.round((subtotal * c.value) / 100) : c.value;
  if (c.maxDiscount) discount = Math.min(discount, c.maxDiscount);
  return Math.min(discount, subtotal);
}

/** Only what the storefront needs to recompute the discount as the cart changes. */
const publicCoupon = (c: CouponDoc) => ({ code: c.code, type: c.type, value: c.value, minOrder: c.minOrder, maxDiscount: c.maxDiscount, description: c.description });

// ——— Public
export async function validateCoupon(req: Request, res: Response) {
  const { coupon, discount } = await evaluateCoupon(req.body.code, req.body.subtotal);
  res.json({ success: true, coupon: publicCoupon(coupon), discount, message: `${coupon.code} applied` });
}

// ——— Admin
export async function listAll(_req: Request, res: Response) {
  res.json({ success: true, items: await Coupon.find().sort({ createdAt: -1 }) });
}
export async function create(req: Request, res: Response) {
  res.status(201).json({ success: true, coupon: await Coupon.create(req.body) });
}
export async function update(req: Request, res: Response) {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!coupon) throw new ApiError(404, 'Coupon not found.');
  res.json({ success: true, coupon });
}
export async function remove(req: Request, res: Response) {
  if (!(await Coupon.findByIdAndDelete(req.params.id))) throw new ApiError(404, 'Coupon not found.');
  res.json({ success: true, message: 'Coupon deleted.' });
}
