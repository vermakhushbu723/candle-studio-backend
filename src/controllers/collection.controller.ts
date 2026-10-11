import type { Request, Response } from 'express';
import { Collection } from '../models/Collection.js';
import { Product } from '../models/Product.js';
import { broadcast } from '../services/notify.js';
import { ApiError } from '../utils/http.js';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Live product count per collection slug. */
async function countsBySlug(onlyActive: boolean) {
  const rows = await Product.aggregate([
    { $match: onlyActive ? { isActive: true } : {} },
    { $unwind: '$collections' },
    { $group: { _id: '$collections', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id as string, r.n as number]));
}

// ——— Public: what the website menu, collection tiles and shop filter use
export async function listPublic(_req: Request, res: Response) {
  const [collections, counts] = await Promise.all([Collection.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }), countsBySlug(true)]);
  res.json({ success: true, collections: collections.map((c) => ({ ...c.toJSON(), productCount: counts.get(c.slug) ?? 0 })) });
}

// ——— Admin
export async function listAdmin(_req: Request, res: Response) {
  const [collections, counts] = await Promise.all([Collection.find().sort({ sortOrder: 1, name: 1 }), countsBySlug(false)]);
  res.json({ success: true, items: collections.map((c) => ({ ...c.toJSON(), productCount: counts.get(c.slug) ?? 0 })) });
}

export async function getOne(req: Request, res: Response) {
  const collection = await Collection.findById(req.params.id);
  if (!collection) throw new ApiError(404, 'Collection not found.');
  const products = await Product.find({ collections: collection.slug }).select('name slug images price stock isActive line').sort({ sortOrder: 1 });
  res.json({ success: true, collection, products });
}

export async function create(req: Request, res: Response) {
  const slug = req.body.slug || slugify(req.body.name);
  if (await Collection.exists({ slug })) throw new ApiError(409, `A collection with the URL “${slug}” already exists.`);
  const { notify, productIds: _ids, ...data } = req.body;
  const collection = await Collection.create({ ...data, slug });
  if (notify && collection.isActive) {
    void broadcast({ title: `New collection: ${collection.name} 🕯️`, body: collection.description || 'Fresh candles just dropped — take a look.', link: `/shop?category=${slug}`, image: collection.image, channels: ['push', 'email'], trigger: 'new-collection', createdBy: req.user?.name });
  }
  if (req.body.productIds?.length) await Product.updateMany({ slug: { $in: req.body.productIds } }, { $addToSet: { collections: slug } });
  res.status(201).json({ success: true, collection });
}

export async function update(req: Request, res: Response) {
  const { slug: _ignored, productIds, ...rest } = req.body; // the slug is permanent — website links use it
  const collection = await Collection.findByIdAndUpdate(req.params.id, rest, { new: true, runValidators: true });
  if (!collection) throw new ApiError(404, 'Collection not found.');
  if (Array.isArray(productIds)) {
    // Replace membership: add the chosen products, remove everything else
    await Promise.all([
      Product.updateMany({ slug: { $in: productIds } }, { $addToSet: { collections: collection.slug } }),
      Product.updateMany({ slug: { $nin: productIds }, collections: collection.slug }, { $pull: { collections: collection.slug } }),
    ]);
  }
  res.json({ success: true, collection });
}

export async function remove(req: Request, res: Response) {
  const collection = await Collection.findByIdAndDelete(req.params.id);
  if (!collection) throw new ApiError(404, 'Collection not found.');
  await Product.updateMany({ collections: collection.slug }, { $pull: { collections: collection.slug } });
  res.json({ success: true, message: 'Collection deleted.' });
}
