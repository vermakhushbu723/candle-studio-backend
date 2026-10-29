import type { Request, Response } from 'express';
import { Product } from '../models/Product.js';
import { broadcast } from '../services/notify.js';
import { ApiError, escapeRegex, paginate } from '../utils/http.js';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** With pack options, the product's price / MRP are those of its first (default) pack. */
type PackBody = { packs?: { price: number; compareAt?: number | null }[]; [key: string]: unknown };
const priceFromPacks = <T extends PackBody>(body: T): T => {
  const first = body.packs?.[0];
  if (!first) return body;
  return { ...body, price: first.price, compareAt: first.compareAt ?? undefined };
};

/** Public catalogue — the storefront loads every live product once and filters client-side. */
export async function listPublic(_req: Request, res: Response) {
  const products = await Product.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 });
  res.json({ success: true, count: products.length, products });
}

export async function getBySlug(req: Request, res: Response) {
  let product = await Product.findOne({ slug: req.params.slug, isActive: true });
  // Old links to a pack that is now a variation of another product open that product
  if (!product) {
    const merged = await Product.findOne({ slug: req.params.slug, mergedInto: { $ne: '' } }, { mergedInto: 1 });
    if (merged) product = await Product.findOne({ slug: merged.mergedInto, isActive: true });
  }
  if (!product) throw new ApiError(404, 'Product not found.');
  res.json({ success: true, product });
}

// ——— Admin
export async function listAdmin(req: Request, res: Response) {
  const { page, limit, skip } = paginate(req.query);
  const filter: Record<string, unknown> = {};
  if (req.query.line) filter.line = req.query.line;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q)), 'i');
    filter.$or = [{ name: rx }, { slug: rx }, { tagline: rx }];
  }
  if (req.query.stock === 'low') filter.stock = { $lt: 10 };
  if (req.query.active === 'true' || req.query.active === 'false') filter.isActive = req.query.active === 'true';
  const [items, total] = await Promise.all([
    Product.find(filter).sort({ sortOrder: 1, createdAt: 1 }).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);
  res.json({ success: true, items, total, page, limit });
}

export async function getById(req: Request, res: Response) {
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found.');
  res.json({ success: true, product });
}

export async function create(req: Request, res: Response) {
  const slug = req.body.slug || slugify(req.body.name);
  // Products without a photo fall back to the storefront's illustrated candle
  const visual = req.body.visual ?? { image: req.body.images?.[0], shape: 'jar', bg: '#F6EDE4', vessel: '#EADBC8', wax: '#FFF9F5' };
  const { notify, ...data } = priceFromPacks(req.body);
  const product = await Product.create({ ...data, slug, visual });
  if (notify && product.isActive) {
    void broadcast({ title: `New at Jyotessa: ${product.name} ✨`, body: product.tagline || `Just launched — ₹${product.price.toLocaleString('en-IN')}.`, link: `/product/${product.slug}`, image: product.images[0], channels: ['push', 'email'], trigger: 'new-product', createdBy: req.user?.name });
  }
  res.status(201).json({ success: true, product });
}

export async function update(req: Request, res: Response) {
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found.');
  product.set(priceFromPacks(req.body));
  // Keep the cover photo in sync with the first image
  if (req.body.images) product.visual = { ...(product.visual ?? {}), image: req.body.images[0] };
  await product.save();
  res.json({ success: true, product });
}

export async function remove(req: Request, res: Response) {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found.');
  res.json({ success: true, message: 'Product deleted.' });
}
