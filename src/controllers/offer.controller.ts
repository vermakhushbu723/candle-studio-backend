import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { Coupon, FollowClaim } from '../models/Engagement.js';
import { Setting, getFollowOffer } from '../models/Setting.js';
import { sendPush } from '../services/push.js';
import { ApiError } from '../utils/http.js';
import { User } from '../models/User.js';

/**
 * Follow & Save — the footer QR code opens /follow on the website. The customer logs in, opens each of
 * our social pages and tells us their Instagram / Facebook username. Instagram and Facebook don't let
 * apps see who follows a page, so the claim waits until the team checks the follower list in the admin;
 * approving it switches the personal one-time coupon on. Limits: one claim per account and one per
 * device (device ID, plus browser fingerprint + IP for a cleared browser on the same phone).
 */

const newCode = () => `FOLLOW${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
const clientIp = (req: Request) => String(req.ip ?? '').replace(/^::ffff:/, '');

type CouponLean = { code: string; expiry: Date; usageLimit: number; usedCount: number; value: number };
const publicCoupon = (c: CouponLean) => ({
  code: c.code,
  expiry: c.expiry,
  used: c.usageLimit > 0 && c.usedCount >= c.usageLimit,
  percent: c.value,
});

/** Public offer details; when logged in, also whether this account already has its coupon. */
export async function getOffer(req: Request, res: Response) {
  const offer = await getFollowOffer();
  const claim = req.user ? await FollowClaim.findOne({ user: req.user.id }).lean() : null;
  const status = claim ? (claim.status ?? 'approved') : null;
  // The coupon is only revealed once the team has verified the follow
  const coupon = claim && status === 'approved' ? ((await Coupon.findOne({ code: claim.couponCode }).lean()) as CouponLean | null) : null;
  res.json({
    success: true,
    offer: { enabled: offer.enabled, percent: offer.percent, validDays: offer.validDays, maxDiscount: offer.maxDiscount, links: offer.links },
    claimed: Boolean(claim),
    status, // null | pending | approved
    handle: claim?.handle ?? null,
    coupon: coupon ? publicCoupon(coupon) : null,
  });
}

/** Has this device already been used for the offer? (checked before asking the customer to log in) */
export async function deviceStatus(req: Request, res: Response) {
  const used = await FollowClaim.exists({ deviceId: String(req.body.deviceId) });
  res.json({ success: true, deviceUsed: Boolean(used) });
}

export async function claimOffer(req: Request, res: Response) {
  const offer = await getFollowOffer();
  if (!offer.enabled) throw new ApiError(400, 'This offer has ended. Keep an eye on our pages for the next one!');

  const userId = req.user!.id;
  const { deviceId, fingerprint } = req.body as { deviceId: string; fingerprint?: string };
  const handle = String(req.body.handle).trim().replace(/^@/, '');
  const visited = [...new Set((req.body.visited as string[]).map(String))];
  const missing = offer.links.filter((l) => !visited.includes(l.key));
  if (missing.length) throw new ApiError(400, `Please follow us on ${missing.map((l) => l.label).join(' and ')} first.`);

  if (await FollowClaim.exists({ user: userId })) throw new ApiError(409, 'You have already claimed this offer — check its status on this page.');
  const ip = clientIp(req);
  const sameDevice = await FollowClaim.exists({ $or: [{ deviceId }, ...(fingerprint && ip ? [{ fingerprint, ip }] : [])] });
  if (sameDevice) throw new ApiError(409, 'This offer has already been claimed on this phone. It can be used once per device.');

  const expiry = new Date(Date.now() + offer.validDays * 24 * 60 * 60 * 1000);
  let code = newCode();
  while (await Coupon.exists({ code })) code = newCode();
  await Coupon.create({
    code,
    type: 'percent',
    value: offer.percent,
    maxDiscount: offer.maxDiscount || undefined,
    expiry,
    usageLimit: 1,
    description: `Follow & Save ${offer.percent}% — personal coupon`,
    owner: userId,
    source: 'follow',
    isActive: false, // switched on when the team approves the claim
  });
  try {
    await FollowClaim.create({ user: userId, deviceId, fingerprint, ip, userAgent: req.get('user-agent'), visited, handle, status: 'pending', couponCode: code });
  } catch (e) {
    // Two taps at once from the same account/device — keep only the first coupon
    await Coupon.deleteOne({ code });
    if ((e as { code?: number }).code === 11000) throw new ApiError(409, 'This offer has already been claimed.');
    throw e;
  }

  res.status(201).json({
    success: true,
    status: 'pending',
    handle,
    coupon: null,
    message: `Thank you! We'll check that @${handle} follows us and switch on your ${offer.percent}% coupon — usually within 24 hours.`,
  });
}

// ——— Admin
export async function getOfferAdmin(_req: Request, res: Response) {
  const [offer, claims, used] = await Promise.all([
    getFollowOffer(),
    FollowClaim.countDocuments(),
    Coupon.countDocuments({ source: 'follow', usedCount: { $gte: 1 } }),
  ]);
  res.json({ success: true, offer, stats: { claims, used } });
}

export async function updateOffer(req: Request, res: Response) {
  await Setting.findOneAndUpdate({ key: 'followOffer' }, { $set: req.body }, { upsert: true, runValidators: true });
  res.json({ success: true, offer: await getFollowOffer(), message: 'Follow & Save offer updated.' });
}

export async function listClaims(_req: Request, res: Response) {
  const claims = await FollowClaim.find().sort({ createdAt: -1 }).limit(200).populate('user', 'name phone email').lean();
  const coupons = await Coupon.find({ code: { $in: claims.map((c) => c.couponCode) } }).lean();
  const byCode = new Map(coupons.map((c) => [c.code, c]));
  res.json({
    success: true,
    items: claims.map((c) => ({
      id: c._id,
      customer: c.user,
      handle: c.handle ?? '',
      status: c.status ?? 'approved',
      couponCode: c.couponCode,
      used: (byCode.get(c.couponCode)?.usedCount ?? 0) >= 1,
      expiry: byCode.get(c.couponCode)?.expiry,
      at: (c as unknown as { createdAt: Date }).createdAt,
    })),
  });
}

/** Admin checked the follower list: approve switches the coupon on (valid from today); reject removes the claim so the customer can try again. */
export async function reviewClaim(req: Request, res: Response) {
  const claim = await FollowClaim.findById(req.params.id);
  if (!claim) throw new ApiError(404, 'Claim not found.');
  const offer = await getFollowOffer();

  if (req.body.action === 'reject') {
    await Promise.all([Coupon.deleteOne({ code: claim.couponCode }), claim.deleteOne()]);
    return res.json({ success: true, message: 'Claim rejected — the customer can follow us and claim again.' });
  }

  const expiry = new Date(Date.now() + offer.validDays * 24 * 60 * 60 * 1000);
  await Coupon.updateOne({ code: claim.couponCode }, { isActive: true, expiry });
  claim.status = 'approved';
  claim.reviewedAt = new Date();
  await claim.save();

  // Let the customer know on their phone (push is skipped when not configured)
  const user = await User.findById(claim.user).select('+pushTokens');
  const tokens = (user?.pushTokens ?? []).map((t) => t.token);
  void sendPush(tokens, { title: `Your ${offer.percent}% coupon is ready 🎉`, body: `Thanks for following Jyotessa! Use code ${claim.couponCode} at checkout.`, link: '/follow' }).catch(() => undefined);
  res.json({ success: true, message: `Approved — coupon ${claim.couponCode} is now active.` });
}
