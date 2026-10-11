import type { Request, Response } from 'express';
import { Setting, getShippingSettings } from '../models/Setting.js';

/** Public: what the website needs to show and calculate shipping. */
export async function publicSettings(_req: Request, res: Response) {
  res.json({ success: true, shipping: await getShippingSettings() });
}

// ——— Admin
export async function getShipping(_req: Request, res: Response) {
  res.json({ success: true, shipping: await getShippingSettings() });
}

export async function updateShipping(req: Request, res: Response) {
  await Setting.findOneAndUpdate({ key: 'shipping' }, { $set: req.body }, { upsert: true, runValidators: true });
  res.json({ success: true, shipping: await getShippingSettings(), message: 'Shipping charges updated.' });
}
