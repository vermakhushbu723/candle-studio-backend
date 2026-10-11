import { Schema, model } from 'mongoose';

/**
 * Curated / seasonal collections (Diwali, Valentine, Winter, Christmas…).
 * Products join a collection through `Product.collections` (array of collection slugs).
 */
const collectionSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['festive', 'curated'], default: 'curated' }, // festive → "Festive Specials" menu
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    tone: { type: String, default: '#F3E4D4' }, // tile background on the website
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

export const Collection = model('Collection', collectionSchema);
