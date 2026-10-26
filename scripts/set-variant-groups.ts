/**
 * Links the catalogue's pack sizes (Single, Pack of 2, Pack of 4…) as variants of each other.
 * Only fills products whose variantGroup is still empty, so nothing set in the admin is overwritten.
 *
 *   npx tsx scripts/set-variant-groups.ts            → dry run (prints what would change)
 *   npx tsx scripts/set-variant-groups.ts --apply    → writes to MONGODB_URI
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { Product } from '../src/models/Product.js';

const APPLY = process.argv.includes('--apply');
const { products } = JSON.parse(readFileSync(new URL('../data/catalog-2026-10.json', import.meta.url), 'utf8')) as {
  products: { slug: string; variantGroup: string; variantLabel: string }[];
};

await mongoose.connect(process.env.MONGODB_URI!);
const empty = new Set((await Product.find({ variantGroup: { $in: ['', null] } }, { slug: 1 })).map((p) => p.slug));
const todo = products.filter((p) => empty.has(p.slug));
for (const p of todo) console.log(`${p.slug.padEnd(32)} → ${p.variantGroup} / ${p.variantLabel}`);
if (APPLY) {
  await Product.bulkWrite(todo.map((p) => ({ updateOne: { filter: { slug: p.slug }, update: { $set: { variantGroup: p.variantGroup, variantLabel: p.variantLabel } } } })));
  console.log(`✔ Updated ${todo.length} products`);
} else console.log(`${todo.length} products to update — dry run, add --apply to write.`);
await mongoose.disconnect();
