import { Schema, model } from 'mongoose';

/** Store-wide settings editable from the admin panel (one document per key). */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    shippingFee: { type: Number, min: 0 },
    freeShippingEnabled: { type: Boolean },
    freeShippingAbove: { type: Number, min: 0 },
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
