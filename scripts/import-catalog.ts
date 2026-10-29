/**
 * Imports the product catalogue from data/catalog-2026-10.json (Candledust pricing catalogue, 48 products).
 *  - creates new products and updates name / price / photos / copy of existing ones (matched by slug)
 *  - keeps stock and sales counts of products that already exist (new products start with STOCK)
 *  - hides (isActive: false) every product that is not in the catalogue — nothing is deleted, so old orders stay intact
 *  - points collection cover photos that still use the old demo photos at the new catalogue photos
 *
 *   npx tsx scripts/import-catalog.ts            → dry run (prints what would change)
 *   npx tsx scripts/import-catalog.ts --apply    → writes to the database
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { Collection } from '../src/models/Collection.js';
import { Product } from '../src/models/Product.js';

const APPLY = process.argv.includes('--apply');
const STOCK = 20;
const file = new URL('../data/catalog-2026-10.json', import.meta.url);
const { products } = JSON.parse(readFileSync(file, 'utf8')) as { products: Record<string, unknown>[] };

const COLLECTION_COVERS: Record<string, string> = {
  'diwali-special': 'designer-diya',
  'valentine-special': 'rose-bubble',
  'spiritual': 'lotus-pond',
  'aesthetic': 'heart-gel-glass',
  'cartoons-kids': 'teddy-bear',
  'ocean': 'ocean-blue-tealight',
  'christmas-special': 'bubble-large',
  'new-year-special': 'bubble-mini',
  'winter': 'dry-fruit-tealight',
};

await mongoose.connect(process.env.MONGODB_URI!);
const slugs = products.map((p) => p.slug as string);
const existing = new Set((await Product.find({ slug: { $in: slugs } }).select('slug')).map((p) => p.slug));
const toHide = await Product.find({ slug: { $nin: slugs }, isActive: true }).select('slug name');

console.log(`${products.length} catalogue products: ${products.length - existing.size} new, ${existing.size} updated`);
console.log(`${toHide.length} other products will be hidden:`, toHide.map((p) => p.slug).join(', ') || '—');

if (APPLY) {
  // Pack sizes merged into another product (scripts/merge-pack-variants.ts) stay hidden
  const merged = new Set((await Product.find({ mergedInto: { $nin: ['', null] } }).select('slug')).map((p) => p.slug));
  for (const p of products) {
    if (merged.has(p.slug as string)) continue;
    await Product.updateOne(
      { slug: p.slug },
      { $set: { ...p, isActive: true }, $setOnInsert: { stock: STOCK, soldCount: 0 } },
      { upsert: true, runValidators: true },
    );
  }
  await Product.updateMany({ slug: { $nin: slugs } }, { $set: { isActive: false } });
  for (const [slug, family] of Object.entries(COLLECTION_COVERS)) {
    await Collection.updateOne(
      { slug, image: { $not: /\/catalog\// } },
      { $set: { image: `/images/products/catalog/${family}.jpg` } },
    );
  }
  console.log('✔ Catalogue imported. Active products:', await Product.countDocuments({ isActive: true }));
} else {
  console.log('Dry run — add --apply to write.');
}
await mongoose.disconnect();
