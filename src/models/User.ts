import bcrypt from 'bcryptjs';
import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // Customers sign in with phone + OTP or Google, so either email or phone may be missing
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    phone: { type: String, unique: true, sparse: true },
    googleId: { type: String, unique: true, sparse: true },
    password: { type: String, select: false }, // admin accounts only
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
    isBlocked: { type: Boolean, default: false },
    lastLoginAt: Date,
    loginMethod: { type: String, enum: ['phone', 'google', 'password'], default: undefined },
    // Firebase Cloud Messaging tokens (one per browser/device the customer allowed notifications on)
    pushTokens: {
      type: [{ token: { type: String, required: true }, device: String, addedAt: { type: Date, default: Date.now } }],
      default: [],
      select: false,
    },
    // Marketing (new products, offers) — order updates are always sent
    notifyOffers: { type: Boolean, default: true },
  },
  { timestamps: true },
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (plain: string) {
  return this.password ? bcrypt.compare(plain, this.password) : Promise.resolve(false);
};

userSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>> & {
  comparePassword(plain: string): Promise<boolean>;
};
export const User = model('User', userSchema);
