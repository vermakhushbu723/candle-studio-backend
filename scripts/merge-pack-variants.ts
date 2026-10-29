/**
 * Turns pack sizes into variations of ONE product. For every live product that belongs to a catalogue
 * family (variantGroup):
 *  - its `packs` become every pack size of that family from data/catalog-2026-10.json (label + price),
 *    with the product's own pack first so its current price stays the default
 *  - other live products of the same family are hidden (isActive: false, mergedInto: <slug>) — nothing is
 *    deleted, old orders stay intact and old links open the product that holds the packs now
 * Products that already have packs (set in the admin) are left alone.
 *
 *   npx tsx scripts/merge-pack-variants.ts            → dry run
 *   npx tsx scripts/merge-pack-variants.ts --apply    → writes to MONGODB_URI
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { Product } from '../src/models/Product.js';

type Row = { slug: string; price: number; variantGroup: string; variantLabel: string };
const APPLY = process.argv.includes('--apply');
const catalog = (JSON.parse(readFileSync(new URL('../data/catalog-2026-10.json', import.meta.url), 'utf8')) as { products: Row[] }).products;
const family = new Map<string, Row[]>();
for (const r of catalog) family.set(r.variantGroup, [...(family.get(r.variantGroup) ?? []), r].sort((a, b) => a.price - b.price));

await mongoose.connect(process.env.MONGODB_URI!);
const live = await Product.find({ isActive: true, variantGroup: { $nin: ['', null] } }).sort({ sortOrder: 1, price: 1 });
const handled = new Set<string>();
let changed = 0;

for (const main of live) {
  const group = main.variantGroup;
  const rows = family.get(group) ?? [];
  if (handled.has(group) || rows.length < 2 || main.packs.length) continue;
  handled.add(group);
  // The product's own pack size first (its price stays the default), then the others cheapest first
  const own = rows.find((r) => r.slug === main.slug);
  const ordered = own ? [own, ...rows.filter((r) => r !== own)] : rows;
  const siblings = live.filter((p) => p !== main && p.variantGroup === group);
  const packs = ordered.map((r) => {
    const twin = siblings.find((p) => p.slug === r.slug) ?? (r.slug === main.slug ? main : undefined);
    return { label: r.variantLabel, price: twin?.price ?? r.price, compareAt: twin?.compareAt ?? undefined, images: twin && twin !== main ? twin.images : [] };
  });

  console.log(`${main.slug.padEnd(30)} packs: ${packs.map((x) => `${x.label} ₹${x.price}`).join(' · ')}${siblings.length ? `   (hides ${siblings.map((s) => s.slug).join(', ')})` : ''}`);
  changed++;
  if (!APPLY) continue;

  main.set({
    packs,
    price: packs[0].price,
    compareAt: packs[0].compareAt,
    images: [...new Set([...main.images, ...siblings.flatMap((p) => p.images)])],
    collections: [...new Set([...main.collections, ...siblings.flatMap((p) => p.collections)])],
    // The pack label now lives in the pack picker, so the subtitle keeps only what is shared
    subtitle: own && main.subtitle.startsWith(`${own.variantLabel} · `) ? main.subtitle.slice(own.variantLabel.length + 3) : main.subtitle,
    soldCount: [main, ...siblings].reduce((n, p) => n + (p.soldCount ?? 0), 0),
  });
  await main.save();
  if (siblings.length) await Product.updateMany({ _id: { $in: siblings.map((s) => s._id) } }, { $set: { isActive: false, mergedInto: main.slug } });
}

console.log(APPLY ? `✔ ${changed} products now hold their pack sizes. Live products: ${await Product.countDocuments({ isActive: true })}` : `${changed} products would get pack options — dry run, add --apply to write.`);
await mongoose.disconnect();
