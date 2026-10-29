/**
 * Turns pack sizes that were separate products (lotus-pond, lotus-pond-pack-of-2, lotus-pond-pack-of-4 …)
 * into ONE product with pack options. For every variantGroup with more than one live product:
 *  - the product whose slug is the group name (else the cheapest) keeps the URL and gets `packs`
 *    (label, price, MRP and photos of every member, cheapest first) plus all members' photos
 *  - the other members are hidden (isActive: false, mergedInto: <slug>) — nothing is deleted, old orders
 *    stay intact and old links open the merged product
 *
 *   npx tsx scripts/merge-pack-variants.ts            → dry run
 *   npx tsx scripts/merge-pack-variants.ts --apply    → writes to MONGODB_URI
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Product } from '../src/models/Product.js';

const APPLY = process.argv.includes('--apply');
await mongoose.connect(process.env.MONGODB_URI!);

const live = await Product.find({ isActive: true, variantGroup: { $nin: ['', null] } }).sort({ price: 1, sortOrder: 1 });
const groups = new Map<string, typeof live>();
for (const p of live) groups.set(p.variantGroup, [...(groups.get(p.variantGroup) ?? []), p]);

let merged = 0;
for (const [group, members] of groups) {
  if (members.length < 2) continue;
  const main = members.find((p) => p.slug === group) ?? members[0];
  const others = members.filter((p) => p !== main);
  const packs = members.map((p) => ({ label: p.variantLabel || p.subtitle.split(' · ')[0] || p.name, price: p.price, compareAt: p.compareAt ?? undefined, images: p.images }));
  console.log(`${main.slug.padEnd(26)} ← ${others.map((o) => o.slug).join(', ')}`);
  console.log(`${''.padEnd(26)}   packs: ${packs.map((x) => `${x.label} ₹${x.price}`).join(' · ')}`);
  merged += others.length;
  if (!APPLY) continue;

  main.set({
    packs,
    price: packs[0].price,
    compareAt: packs[0].compareAt,
    images: [...new Set(members.flatMap((p) => p.images))],
    collections: [...new Set(members.flatMap((p) => p.collections))],
    moods: [...new Set(members.flatMap((p) => p.moods))],
    // The pack label now lives in the pack picker, so the subtitle keeps only what is shared
    subtitle: main.subtitle.split(' · ').slice(1).join(' · ') || main.subtitle,
    soldCount: members.reduce((n, p) => n + (p.soldCount ?? 0), 0),
  });
  await main.save();
  await Product.updateMany({ _id: { $in: others.map((o) => o._id) } }, { $set: { isActive: false, mergedInto: main.slug } });
}

console.log(APPLY ? `✔ Merged ${merged} pack products. Live products: ${await Product.countDocuments({ isActive: true })}` : `${merged} pack products would be merged — dry run, add --apply to write.`);
await mongoose.disconnect();
