import { Schema, model } from 'mongoose';

export const LINES = ['pearled', 'handcrafted'] as const;
export const CATEGORIES = ['pearl-kits', 'refills', 'food-inspired', 'love-in-the-air', 'floral', 'luxury', 'wax-fresheners'] as const;
export const COLLECTIONS = [
  'cartoons-kids', 'ocean', 'aesthetic', 'diwali-special', 'christmas-special',
  'valentine-special', 'new-year-special', 'spiritual', 'winter',
] as const;

const productSchema = new Schema(
  {
    // The storefront keys carts, wishlists and URLs by this slug (exposed as `id`)
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    subtitle: { type: String, default: '' },
    line: { type: String, enum: LINES, required: true, index: true },
    category: { type: String, enum: CATEGORIES, required: true, index: true },
    collections: { type: [String], default: [] },
    price: { type: Number, required: true, min: 0 },
    compareAt: { type: Number, min: 0 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviews: { type: Number, default: 0 },
    badge: { type: String, default: '' },
    moods: { type: [String], default: [] },
    tagline: { type: String, default: '' },
    description: { type: String, default: '' },
    includes: { type: [String], default: [] },
    bestFor: { type: String, default: '' },
    howToUse: { type: [String], default: [] },
    fragrances: { type: Boolean, default: false },
    images: { type: [String], default: [] },
    visual: { type: Schema.Types.Mixed, default: {} },
    stock: { type: Number, default: 0, min: 0 },
    soldCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret.slug;
        return ret;
      },
    },
  },
);

export const Product = model('Product', productSchema);
