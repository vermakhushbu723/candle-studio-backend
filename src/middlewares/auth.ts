import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/http.js';

export interface AuthUser {
  id: string;
  role: 'customer' | 'admin';
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const signToken = (u: { _id: unknown; role: string }) =>
  jwt.sign({ sub: String(u._id), role: u.role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);

async function resolveUser(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret) as { sub: string };
    const user = await User.findById(payload.sub);
    if (!user || user.isBlocked) return undefined;
    return { id: String(user._id), role: user.role, email: user.email, name: user.name } as AuthUser;
  } catch {
    return undefined;
  }
}

/** Attaches req.user if a valid token is present; never rejects. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  req.user = await resolveUser(req);
  next();
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  req.user = await resolveUser(req);
  if (!req.user) return next(new ApiError(401, 'Please log in to continue.'));
  next();
}

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  req.user = await resolveUser(req);
  if (!req.user) return next(new ApiError(401, 'Please log in to continue.'));
  if (req.user.role !== 'admin') return next(new ApiError(403, 'Admin access only.'));
  next();
}
