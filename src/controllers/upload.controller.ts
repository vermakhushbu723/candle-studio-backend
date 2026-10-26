import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { ApiError } from '../utils/http.js';

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const UPLOAD_TYPES = Object.keys(EXTENSIONS);

/** Admin photo upload: the raw image is the request body. Returns its public URL. */
export async function uploadImage(req: Request, res: Response) {
  const ext = EXTENSIONS[req.headers['content-type'] ?? ''];
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) throw new ApiError(400, 'Send a JPG, PNG or WebP image.');

  const month = new Date().toISOString().slice(0, 7);
  const dir = path.join(env.uploadDir, 'products', month);
  await mkdir(dir, { recursive: true });
  const file = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.${ext}`;
  await writeFile(path.join(dir, file), req.body);

  const url = `${req.protocol}://${req.get('host')}/uploads/products/${month}/${file}`;
  res.status(201).json({ success: true, url });
}
