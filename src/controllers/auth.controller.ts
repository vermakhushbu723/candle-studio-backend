import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { env } from '../config/env.js';
import { pushEnabled } from '../services/push.js';
import { signToken } from '../middlewares/auth.js';
import { Otp } from '../models/Otp.js';
import { User, type UserDoc } from '../models/User.js';
import { ApiError } from '../utils/http.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_AFTER_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

const publicUser = (u: UserDoc) => ({
  id: String(u._id),
  name: u.name,
  email: u.email ?? '',
  phone: u.phone ?? '',
  avatar: u.avatar ?? '',
  role: u.role,
  createdAt: (u as unknown as { createdAt: Date }).createdAt,
});

const hash = (s: string) => createHash('sha256').update(s).digest();

async function signIn(res: Response, user: UserDoc, status = 200) {
  if (user.isBlocked) throw new ApiError(403, 'This account has been blocked. Please contact support.');
  user.lastLoginAt = new Date();
  await user.save();
  res.status(status).json({ success: true, token: signToken(user), user: publicUser(user) });
}

// ——— Website: phone + OTP
export async function sendOtp(req: Request, res: Response) {
  const { phone } = req.body;
  const existing = await Otp.findOne({ phone });
  if (existing && Date.now() - existing.sentAt.getTime() < RESEND_AFTER_MS) {
    throw new ApiError(429, 'Please wait 30 seconds before requesting another OTP.');
  }
  if (!env.otpDevMode) {
    // Wire an SMS provider (MSG91 / Twilio / Firebase) here before turning dev mode off
    throw new ApiError(503, 'OTP by SMS is not configured yet. Please sign in with Google.');
  }
  const code = String(randomInt(100000, 1000000));
  await Otp.findOneAndUpdate(
    { phone },
    { codeHash: hash(`${phone}:${code}`).toString('hex'), attempts: 0, sentAt: new Date(), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    { upsert: true },
  );
  console.log(`[OTP dev mode] +91 ${phone} → ${code}`);
  const user = await User.findOne({ phone, role: 'customer' });
  res.json({
    success: true,
    isNewUser: !user,
    message: `OTP sent to +91 ${phone}`,
    ...(env.otpDevMode ? { devOtp: code } : {}),
  });
}

export async function verifyOtp(req: Request, res: Response) {
  const { phone, otp, name, email } = req.body;
  const record = await Otp.findOne({ phone });
  if (!record || record.expiresAt < new Date()) throw new ApiError(400, 'OTP expired. Please request a new one.');
  if (record.attempts >= MAX_ATTEMPTS) throw new ApiError(429, 'Too many wrong attempts. Please request a new OTP.');

  const ok = timingSafeEqual(Buffer.from(record.codeHash, 'hex'), hash(`${phone}:${otp}`));
  if (!ok) {
    record.attempts += 1;
    await record.save();
    throw new ApiError(400, 'Incorrect OTP. Please try again.');
  }

  await record.deleteOne();
  await signInPhone(res, phone, name, email);
}

/** Finds (or creates, when a name is given) the customer for a verified mobile number and signs them in. */
async function signInPhone(res: Response, phone: string, name?: string, email?: string) {
  let user = (await User.findOne({ phone })) as UserDoc | null;
  if (user && user.role !== 'customer') throw new ApiError(403, 'Please use the admin panel to sign in.');
  if (!user) {
    if (!name) throw new ApiError(400, 'name: Please tell us your name');
    if (email && (await User.exists({ email }))) throw new ApiError(409, 'That email is already linked to another account.');
    user = (await User.create({ name, phone, email: email || undefined, loginMethod: 'phone' })) as UserDoc;
    return signIn(res, user, 201);
  }
  user.loginMethod = 'phone';
  await signIn(res, user);
}

// ——— Website: phone + OTP by SMS through Firebase Phone Auth (Google sends the SMS; no DLT needed)
/** Lets the login form know whether to ask for a name before sending the SMS. */
export async function phoneStatus(req: Request, res: Response) {
  res.json({ success: true, isNewUser: !(await User.exists({ phone: req.body.phone, role: 'customer' })) });
}

/** The website verified the SMS code with Firebase and sends us the Firebase ID token. */
export async function firebasePhoneLogin(req: Request, res: Response) {
  if (!pushEnabled()) throw new ApiError(503, 'Phone login is not configured yet.'); // initialises Firebase Admin
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(req.body.idToken);
  } catch {
    throw new ApiError(401, 'OTP verification failed. Please try again.');
  }
  const m = /^\+91([6-9]\d{9})$/.exec(decoded.phone_number ?? '');
  if (decoded.firebase?.sign_in_provider !== 'phone' || !m) throw new ApiError(401, 'Please sign in with an Indian mobile number.');
  await signInPhone(res, m[1], req.body.name, req.body.email || undefined);
}

// ——— Website: Google sign-in (ID token from Google Identity Services)
export async function googleLogin(req: Request, res: Response) {
  if (!env.googleClientId) throw new ApiError(503, 'Google sign-in is not configured yet.');
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(req.body.credential)}`);
  const info = (await r.json().catch(() => ({}))) as { aud?: string; sub?: string; email?: string; email_verified?: string | boolean; name?: string; picture?: string };
  if (!r.ok || info.aud !== env.googleClientId || !info.sub) throw new ApiError(401, 'Google sign-in failed. Please try again.');
  if (!info.email || String(info.email_verified) !== 'true') throw new ApiError(401, 'Your Google email is not verified.');

  const email = info.email.toLowerCase();
  let user = (await User.findOne({ $or: [{ googleId: info.sub }, { email }] })) as UserDoc | null;
  if (user && user.role !== 'customer') throw new ApiError(403, 'Please use the admin panel to sign in.');
  if (!user) {
    user = (await User.create({ name: info.name || email.split('@')[0], email, googleId: info.sub, loginMethod: 'google', avatar: info.picture ?? '' })) as UserDoc;
    return signIn(res, user, 201);
  }
  if (!user.googleId) user.googleId = info.sub;
  user.loginMethod = 'google';
  if (info.picture) user.avatar = info.picture; // keep the photo fresh
  await signIn(res, user);
}

// ——— Admin panel: email + password
export async function adminLogin(req: Request, res: Response) {
  const { email, password } = req.body;
  const user = (await User.findOne({ email }).select('+password')) as UserDoc | null;
  if (!user || !(await user.comparePassword(password))) throw new ApiError(401, 'Email or password is incorrect.');
  if (user.role !== 'admin') throw new ApiError(403, 'This account does not have admin access.');
  await signIn(res, user);
}

export async function me(req: Request, res: Response) {
  const user = (await User.findById(req.user!.id)) as UserDoc;
  res.json({ success: true, user: publicUser(user) });
}

export async function updateMe(req: Request, res: Response) {
  for (const field of ['email', 'phone'] as const) {
    if (req.body[field] && (await User.exists({ [field]: req.body[field], _id: { $ne: req.user!.id } }))) {
      throw new ApiError(409, `That ${field} is already used by another account.`);
    }
  }
  const user = (await User.findByIdAndUpdate(req.user!.id, req.body, { new: true })) as UserDoc;
  res.json({ success: true, user: publicUser(user) });
}

export async function changePassword(req: Request, res: Response) {
  const user = (await User.findById(req.user!.id).select('+password')) as UserDoc;
  if (!(await user.comparePassword(req.body.current))) throw new ApiError(400, 'Current password is incorrect.');
  user.password = req.body.next;
  await user.save();
  res.json({ success: true, message: 'Password updated.' });
}
