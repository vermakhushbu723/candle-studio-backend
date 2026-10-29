import { Schema, model } from 'mongoose';

export const LINES = ['pearled', 'handcrafted'] as const;
export const CATEGORIES = [
  // Current catalogue (Candledust pricing catalogue, Oct 2026)
  'pooja-festive', 'food-inspired', 'bubble-candles', 'floral', 'floating-candles', 'jars-glass', 'tealights', 'cute-gifts',
  // Earlier ranges (kept so older products can still be edited or re-activated)
  'pearl-kits', 'refills', 'love-in-the-air', 'luxury', 'wax-fresheners',
] as const;
export const COLLECTIONS = [
  'cartoons-kids', 'ocean', 'aesthetic', 'diwali-special', 'christmas-special',
  'valentine-special', 'new-year-special', 'spiritual', 'winter',
] as const;

// A colour the customer can pick on the product page; its photos replace the gallery when selected
const colorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    hex: { type: String, default: '' },
    images: { type: [String], default: [] },
  },
  { _id: false },
);

// A pack / quantity option of the same product (Single, Pack of 2…) with its own price and photos
const packSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    compareAt: { type: Number, min: 0 },
    images: { type: [String], default: [] },
  },
  { _id: false },
);

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
    // Variations the customer picks on the product page — all inside this one product
    packs: { type: [packSchema], default: [] }, // first pack = default; `price` mirrors it
    colors: { type: [colorSchema], default: [] },
    fragranceOptions: { type: [String], default: [] },
    // Legacy: pack sizes used to be separate products linked by a group; merged ones point at the product that holds them now
    variantGroup: { type: String, default: '', index: true },
    variantLabel: { type: String, default: '' },
    mergedInto: { type: String, default: '' },
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
