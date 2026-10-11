import { Schema, model } from 'mongoose';

/** One pending login code per phone. MongoDB removes it automatically once expired. */
const otpSchema = new Schema({
  phone: { type: String, required: true, unique: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  sentAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

export const Otp = model('Otp', otpSchema);
