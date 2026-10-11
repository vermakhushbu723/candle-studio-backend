import type { Request, Response } from 'express';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { broadcast, channelStatus } from '../services/notify.js';
import { paginate } from '../utils/http.js';

// ——— Customer (logged in): register this browser for push, and offer-update preference
export async function addDevice(req: Request, res: Response) {
  const { token, device } = req.body;
  // A browser token belongs to one account at a time (e.g. shared laptop → last login wins)
  await User.updateMany({ _id: { $ne: req.user!.id }, 'pushTokens.token': token }, { $pull: { pushTokens: { token } } });
  const user = await User.findById(req.user!.id).select('+pushTokens');
  if (user && !user.pushTokens.some((t) => t.token === token)) {
    user.pushTokens.push({ token, device: device?.slice(0, 120), addedAt: new Date() });
    if (user.pushTokens.length > 10) user.pushTokens.splice(0, user.pushTokens.length - 10); // keep the latest 10 devices
    await user.save();
  }
  res.json({ success: true, message: 'Notifications turned on for this device.' });
}

export async function removeDevice(req: Request, res: Response) {
  await User.updateOne({ _id: req.user!.id }, { $pull: { pushTokens: { token: req.body.token } } });
  res.json({ success: true });
}

export async function getPreferences(req: Request, res: Response) {
  const user = await User.findById(req.user!.id).select('+pushTokens notifyOffers');
  res.json({ success: true, notifyOffers: user?.notifyOffers !== false, devices: user?.pushTokens.length ?? 0 });
}

export async function setPreferences(req: Request, res: Response) {
  await User.updateOne({ _id: req.user!.id }, { notifyOffers: req.body.notifyOffers });
  res.json({ success: true, notifyOffers: req.body.notifyOffers });
}

// ——— Admin
export async function list(req: Request, res: Response) {
  const { page, limit, skip } = paginate(req.query);
  const [items, total, customers, withPush, withEmail, optedIn] = await Promise.all([
    Notification.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(),
    User.countDocuments({ role: 'customer', isBlocked: false }),
    User.countDocuments({ role: 'customer', isBlocked: false, 'pushTokens.0': { $exists: true } }),
    User.countDocuments({ role: 'customer', isBlocked: false, email: { $exists: true, $ne: '' } }),
    User.countDocuments({ role: 'customer', isBlocked: false, notifyOffers: { $ne: false } }),
  ]);
  res.json({ success: true, items, total, page, limit, channels: channelStatus(), audience: { customers, withPush, withEmail, optedIn } });
}

export async function send(req: Request, res: Response) {
  const item = await broadcast({ ...req.body, trigger: 'manual', createdBy: req.user?.name });
  res.status(202).json({ success: true, item, message: 'Sending… refresh in a few seconds to see delivery numbers.' });
}
