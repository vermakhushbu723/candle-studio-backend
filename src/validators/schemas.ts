import { z } from 'zod';
import { CATEGORIES, LINES } from '../models/Product.js';
import { ORDER_STATUSES, PAYMENT_METHODS } from '../models/Order.js';

const notifyFlag = { notify: z.boolean().optional() }; // "Notify customers" checkbox on create forms

// Same rules as the storefront forms
const phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'must be a valid 10-digit mobile number');
const pincode = z.string().trim().regex(/^\d{6}$/, 'must be 6 digits');
const email = z.string().trim().toLowerCase().email();

// ——— Auth: website (phone + OTP, Google) and admin (email + password)
export const otpSendSchema = z.object({ phone });
export const otpVerifySchema = z.object({
  phone,
  otp: z.string().trim().regex(/^\d{6}$/, 'must be the 6-digit code'),
  name: z.string().trim().min(2).optional(), // required only for a new account
  email: email.optional().or(z.literal('')),
});
export const googleSchema = z.object({ credential: z.string().min(20) });
export const phoneStatusSchema = z.object({ phone });
export const firebasePhoneSchema = z.object({
  idToken: z.string().min(100),
  name: z.string().trim().min(2).optional(), // required only for a new account
  email: email.optional().or(z.literal('')),
});
export const loginSchema = z.object({ email, password: z.string().min(1) });
export const profileSchema = z.object({
  name: z.string().trim().min(2).optional(),
  email: email.optional(),
  phone: phone.optional().or(z.literal('')),
});
export const passwordSchema = z.object({ current: z.string().min(1), next: z.string().min(6) });

// ——— Checkout
export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(20),
        fragrance: z.string().nullish(),
        color: z.string().nullish(),
      }),
    )
    .min(1),
  fullName: z.string().trim().min(2),
  phone,
  email,
  line1: z.string().trim().min(5),
  city: z.string().trim().min(2),
  state: z.string().trim().min(2),
  pincode,
  giftNote: z.string().trim().max(300).optional(),
  payment: z.enum(PAYMENT_METHODS),
  couponCode: z.string().trim().toUpperCase().nullish(),
});
export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});
export const couponCheckSchema = z.object({ code: z.string().trim().min(1, 'Enter a coupon code'), subtotal: z.number().nonnegative() });

// ——— Website forms
export const inquirySchema = z.object({
  name: z.string().trim().min(2),
  email,
  phone: phone.optional().or(z.literal('')),
  topic: z.string().trim().default('order'),
  message: z.string().trim().min(10),
});
export const ticketSchema = z.object({
  name: z.string().trim().min(2),
  phone,
  topic: z.string().trim().min(2),
  message: z.string().trim().min(5),
});

// ——— Admin
export const orderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().optional(),
  awb: z.string().optional(),
  courier: z.string().optional(),
  paymentStatus: z.enum(['Pending', 'Paid', 'Refunded', 'Failed']).optional(),
});
export const statusNoteSchema = z.object({ status: z.string().optional(), note: z.string().trim().optional() });
export const couponSchema = z.object({
  ...notifyFlag,
  code: z.string().trim().toUpperCase().min(3),
  type: z.enum(['percent', 'fixed']),
  value: z.number().positive(),
  minOrder: z.number().nonnegative().default(0),
  maxDiscount: z.number().positive().optional(),
  expiry: z.string(),
  usageLimit: z.number().int().nonnegative().default(0),
  description: z.string().default(''),
  isActive: z.boolean().default(true),
});
// ——— Notifications
export const deviceSchema = z.object({ token: z.string().min(20).max(4096), device: z.string().max(300).optional() });
export const preferencesSchema = z.object({ notifyOffers: z.boolean() });
export const broadcastSchema = z.object({
  title: z.string().trim().min(3).max(80),
  body: z.string().trim().min(3).max(240),
  link: z.string().trim().max(300).optional(),
  image: z.string().trim().max(500).optional(),
  channels: z.array(z.enum(['push', 'email'])).min(1),
});

export const followClaimSchema = z.object({
  deviceId: z.string().trim().min(8).max(100),
  fingerprint: z.string().trim().max(200).optional(),
  visited: z.array(z.string().max(40)).max(20),
});
export const deviceStatusSchema = z.object({ deviceId: z.string().trim().min(8).max(100) });
export const followOfferSchema = z.object({
  enabled: z.boolean(),
  percent: z.number().int().min(1).max(90),
  validDays: z.number().int().min(1).max(365),
  maxDiscount: z.number().int().min(0).max(100000),
  links: z
    .array(z.object({ key: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(40), url: z.string().trim().url() }))
    .min(1)
    .max(8),
});
export const shippingSettingsSchema = z.object({
  shippingFee: z.number().int().min(0).max(5000),
  freeShippingEnabled: z.boolean(),
  freeShippingAbove: z.number().int().min(0).max(1000000),
});
export const collectionSchema = z.object({
  ...notifyFlag,
  name: z.string().trim().min(2),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, 'use lowercase letters, numbers and dashes').optional(),
  type: z.enum(['festive', 'curated']).default('curated'),
  description: z.string().default(''),
  image: z.string().default(''),
  tone: z.string().default('#F3E4D4'),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  productIds: z.array(z.string()).optional(), // product slugs in this collection
});
export const productSchema = z.object({
  ...notifyFlag,
  name: z.string().trim().min(2),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, 'use lowercase letters, numbers and dashes').optional(),
  subtitle: z.string().default(''),
  line: z.enum(LINES),
  category: z.enum(CATEGORIES),
  collections: z.array(z.string()).default([]),
  price: z.number().nonnegative(),
  compareAt: z.number().nonnegative().optional(),
  rating: z.number().min(0).max(5).default(0),
  reviews: z.number().int().nonnegative().default(0),
  badge: z.string().default(''),
  moods: z.array(z.string()).default([]),
  tagline: z.string().default(''),
  description: z.string().default(''),
  includes: z.array(z.string()).default([]),
  bestFor: z.string().default(''),
  howToUse: z.array(z.string()).default([]),
  fragrances: z.boolean().default(false),
  images: z.array(z.string()).default([]),
  colors: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        hex: z.string().trim().regex(/^(#[0-9a-fA-F]{6})?$/, 'use a colour like #C0392B').default(''),
        images: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  variantGroup: z.string().trim().regex(/^[a-z0-9-]*$/, 'use lowercase letters, numbers and dashes').default(''),
  variantLabel: z.string().trim().default(''),
  visual: z.record(z.unknown()).optional(),
  stock: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
