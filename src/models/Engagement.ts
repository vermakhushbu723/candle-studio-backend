// Everything customers submit through website forms (except orders & accounts): the admin inbox.
import { Schema, model } from 'mongoose';

const noteSchema = new Schema({ by: String, text: String, at: { type: Date, default: Date.now } }, { _id: false });

/** Contact page → "Send us a message" */
export const Inquiry = model(
  'Inquiry',
  new Schema(
    {
      name: { type: String, required: true },
      email: { type: String, required: true, lowercase: true },
      phone: String,
      topic: { type: String, default: 'order' }, // order | bulk | custom | other
      message: { type: String, required: true },
      status: { type: String, enum: ['New', 'In progress', 'Resolved'], default: 'New', index: true },
      notes: { type: [noteSchema], default: [] },
    },
    { timestamps: true },
  ),
);

/** Support chatbot → "Leave us a message" (callback requests with a ticket number) */
export const Ticket = model(
  'Ticket',
  new Schema(
    {
      ticketId: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      phone: { type: String, required: true },
      topic: { type: String, required: true },
      message: { type: String, required: true },
      status: { type: String, enum: ['Open', 'In progress', 'Resolved', 'Closed'], default: 'Open', index: true },
      notes: { type: [noteSchema], default: [] },
    },
    { timestamps: true },
  ),
);

/** Discount coupons (checkout coupon box) */
export const Coupon = model(
  'Coupon',
  new Schema(
    {
      code: { type: String, required: true, unique: true, uppercase: true, trim: true },
      type: { type: String, enum: ['percent', 'fixed'], required: true },
      value: { type: Number, required: true, min: 0 },
      minOrder: { type: Number, default: 0 },
      maxDiscount: Number,
      expiry: { type: Date, required: true },
      usageLimit: { type: Number, default: 0 }, // 0 = unlimited
      usedCount: { type: Number, default: 0 },
      description: { type: String, default: '' },
      isActive: { type: Boolean, default: true },
      // Personal coupons (e.g. Follow & Save) can only be used by this customer
      owner: { type: Schema.Types.ObjectId, ref: 'User', index: true },
      source: { type: String, default: 'admin' }, // admin | follow
    },
    { timestamps: true },
  ),
);

/**
 * One Follow & Save claim per customer AND per device. `deviceId` is a random ID the browser/app keeps;
 * `fingerprint` (browser/phone traits) + IP catches a cleared browser on the same phone.
 */
export const FollowClaim = model(
  'FollowClaim',
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
      deviceId: { type: String, required: true, unique: true },
      fingerprint: { type: String, index: true },
      ip: { type: String, index: true },
      userAgent: String,
      visited: [String],
      couponCode: { type: String, required: true },
    },
    { timestamps: true },
  ),
);
