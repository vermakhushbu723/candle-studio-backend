import { Schema, model } from 'mongoose';

/** Store-wide settings editable from the admin panel (one document per key). */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    shippingFee: { type: Number, min: 0 },
    freeShippingEnabled: { type: Boolean },
    freeShippingAbove: { type: Number, min: 0 },
    deliveryStates: { type: [String], default: undefined }, // empty = all of India
    // key "followOffer": scan the footer QR → follow us → personal discount coupon
    enabled: { type: Boolean },
    percent: { type: Number, min: 1, max: 90 },
    validDays: { type: Number, min: 1 },
    maxDiscount: { type: Number, min: 0 },
    links: [{ _id: false, key: String, label: String, url: String }],
  },
  { timestamps: true },
);

export const Setting = model('Setting', settingSchema);

export interface ShippingSettings {
  shippingFee: number;
  freeShippingEnabled: boolean;
  freeShippingAbove: number;
  deliveryStates: string[]; // states we deliver to; empty = all of India
}

// Used until the admin saves their own values
export const DEFAULT_SHIPPING: ShippingSettings = { shippingFee: 79, freeShippingEnabled: true, freeShippingAbove: 899, deliveryStates: ['Uttar Pradesh'] };

export async function getShippingSettings(): Promise<ShippingSettings> {
  const doc = await Setting.findOne({ key: 'shipping' }).lean();
  return {
    shippingFee: doc?.shippingFee ?? DEFAULT_SHIPPING.shippingFee,
    freeShippingEnabled: doc?.freeShippingEnabled ?? DEFAULT_SHIPPING.freeShippingEnabled,
    freeShippingAbove: doc?.freeShippingAbove ?? DEFAULT_SHIPPING.freeShippingAbove,
    deliveryStates: doc?.deliveryStates ?? DEFAULT_SHIPPING.deliveryStates,
  };
}

// First two digits of the pincodes of a state (India Post circles) — used to catch a wrong state / pincode pair
const PIN_PREFIXES: Record<string, string[]> = { 'Uttar Pradesh': ['20', '21', '22', '23', '24', '25', '26', '27', '28'] };

/** Why we can't deliver to this address, or null when we can. Same rule as the website and app checkout. */
export function deliveryError(state: string, pincode: string, s: ShippingSettings) {
  if (!s.deliveryStates.length) return null;
  const match = s.deliveryStates.find((x) => x.toLowerCase() === state.trim().toLowerCase());
  const where = s.deliveryStates.join(', ');
  if (!match) return `Sorry, we currently deliver only in ${where}.`;
  const prefixes = PIN_PREFIXES[match];
  if (prefixes && !prefixes.includes(pincode.slice(0, 2))) return `This pincode is not in ${match}. We currently deliver only in ${where}.`;
  return null;
}

/** Shipping for an order total after discounts — same rule as the website cart. */
export function shippingFor(amountAfterDiscount: number, s: ShippingSettings) {
  if (amountAfterDiscount === 0) return 0;
  if (s.freeShippingEnabled && amountAfterDiscount >= s.freeShippingAbove) return 0;
  return s.shippingFee;
}

// ——— Follow & Save offer (footer QR code)
export interface FollowLink {
  key: string;
  label: string;
  url: string;
}
export interface FollowOfferSettings {
  enabled: boolean;
  percent: number; // discount on the personal coupon
  validDays: number; // coupon expiry after it is claimed
  maxDiscount: number; // 0 = no cap
  links: FollowLink[]; // pages the customer opens before claiming
}

export const DEFAULT_FOLLOW_OFFER: FollowOfferSettings = {
  enabled: true,
  percent: 10,
  validDays: 30,
  maxDiscount: 0,
  links: [
    { key: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/jyotessa/' },
    { key: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/jyotessa/' },
    { key: 'google', label: 'Google', url: 'https://g.page/r/CQ2T_G0wSr7nECE/review' },
  ],
};

export async function getFollowOffer(): Promise<FollowOfferSettings> {
  const doc = await Setting.findOne({ key: 'followOffer' }).lean();
  const d = DEFAULT_FOLLOW_OFFER;
  return {
    enabled: doc?.enabled ?? d.enabled,
    percent: doc?.percent ?? d.percent,
    validDays: doc?.validDays ?? d.validDays,
    maxDiscount: doc?.maxDiscount ?? d.maxDiscount,
    links: doc?.links?.length ? doc.links.map((l) => ({ key: l.key ?? '', label: l.label ?? '', url: l.url ?? '' })) : d.links,
  };
}
