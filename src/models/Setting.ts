import { Schema, model } from 'mongoose';

/** Store-wide settings editable from the admin panel (one document per key). */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    shippingFee: { type: Number, min: 0 },
    freeShippingEnabled: { type: Boolean },
    freeShippingAbove: { type: Number, min: 0 },
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
}

// Used until the admin saves their own values
export const DEFAULT_SHIPPING: ShippingSettings = { shippingFee: 79, freeShippingEnabled: true, freeShippingAbove: 899 };

export async function getShippingSettings(): Promise<ShippingSettings> {
  const doc = await Setting.findOne({ key: 'shipping' }).lean();
  return {
    shippingFee: doc?.shippingFee ?? DEFAULT_SHIPPING.shippingFee,
    freeShippingEnabled: doc?.freeShippingEnabled ?? DEFAULT_SHIPPING.freeShippingEnabled,
    freeShippingAbove: doc?.freeShippingAbove ?? DEFAULT_SHIPPING.freeShippingAbove,
  };
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
