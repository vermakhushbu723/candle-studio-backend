import type { Request, Response } from 'express';
import { Inquiry, Ticket } from '../models/Engagement.js';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { User } from '../models/User.js';
import { ApiError, escapeRegex, paginate } from '../utils/http.js';

const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const OPEN_ORDER = ['Order Placed', 'Packed', 'Shipped', 'Out for Delivery'];

/** Everything the dashboard needs in one round trip. */
export async function dashboard(_req: Request, res: Response) {
  const today = startOfDay();
  const since30 = new Date(today.getTime() - 29 * 86400000);
  const notCancelled = { status: { $nin: ['Cancelled', 'Payment Pending'] } }; // only real, confirmed sales

  const [
    salesAll, salesToday, orders, customers, products, lowStock, pending, cancelled,
    newInquiries, openTickets, daily, monthly, byLine, byCategory, byPayment, topProducts, recentOrders, statusBreakdown,
  ] = await Promise.all([
    Order.aggregate([{ $match: notCancelled }, { $group: { _id: null, v: { $sum: '$total' } } }]),
    Order.aggregate([{ $match: { ...notCancelled, createdAt: { $gte: today } } }, { $group: { _id: null, v: { $sum: '$total' }, n: { $sum: 1 } } }]),
    Order.countDocuments(),
    User.countDocuments({ role: 'customer' }),
    Product.countDocuments(),
    Product.countDocuments({ stock: { $lt: 10 } }),
    Order.countDocuments({ status: { $in: OPEN_ORDER } }),
    Order.countDocuments({ status: 'Cancelled' }),
    Inquiry.countDocuments({ status: 'New' }),
    Ticket.countDocuments({ status: { $in: ['Open', 'In progress'] } }),
    Order.aggregate([
      { $match: { ...notCancelled, createdAt: { $gte: since30 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, sales: { $sum: '$total' }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: notCancelled },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, sales: { $sum: '$total' }, orders: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 12 },
      { $sort: { _id: 1 } },
    ]),
    Product.aggregate([{ $group: { _id: '$line', sold: { $sum: '$soldCount' }, products: { $sum: 1 } } }]),
    Product.aggregate([{ $group: { _id: '$category', sold: { $sum: '$soldCount' }, products: { $sum: 1 } } }, { $sort: { sold: -1 } }]),
    Order.aggregate([{ $match: notCancelled }, { $group: { _id: '$paymentMethod', count: { $sum: 1 }, total: { $sum: '$total' } } }]),
    Product.find().sort({ soldCount: -1 }).limit(5).select('name slug images soldCount price category stock'),
    Order.find().sort({ createdAt: -1 }).limit(6),
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  // Fill empty days so the chart is continuous
  const dailyMap = new Map(daily.map((d) => [d._id, d]));
  const dailySeries = Array.from({ length: 30 }, (_, i) => {
    const key = new Date(since30.getTime() + i * 86400000).toISOString().slice(0, 10);
    const hit = dailyMap.get(key);
    return { date: key, sales: hit?.sales ?? 0, orders: hit?.orders ?? 0 };
  });

  res.json({
    success: true,
    cards: {
      todaySales: salesToday[0]?.v ?? 0,
      todayOrders: salesToday[0]?.n ?? 0,
      totalSales: salesAll[0]?.v ?? 0,
      orders,
      customers,
      products,
      lowStock,
      pendingOrders: pending,
      cancelledOrders: cancelled,
      newInquiries,
      openTickets,
    },
    charts: {
      daily: dailySeries,
      monthly: monthly.map((m) => ({ month: m._id, sales: m.sales, orders: m.orders })),
      byLine: byLine.map((l) => ({ line: l._id, sold: l.sold, products: l.products })),
      byCategory: byCategory.map((c) => ({ category: c._id, sold: c.sold, products: c.products })),
      byPayment: byPayment.map((p) => ({ method: p._id, count: p.count, total: p.total })),
      statusBreakdown: statusBreakdown.map((s) => ({ status: s._id, count: s.count })),
    },
    topProducts,
    recentOrders: recentOrders.map((o) => ({
      id: o.orderId, name: o.customer?.name, total: o.total, status: o.status, date: (o as unknown as { createdAt: Date }).createdAt,
    })),
  });
}

/** Sidebar badge counts. */
export async function counts(_req: Request, res: Response) {
  const [inquiries, tickets, orders, lowStock] = await Promise.all([
    Inquiry.countDocuments({ status: 'New' }),
    Ticket.countDocuments({ status: 'Open' }),
    Order.countDocuments({ status: 'Order Placed' }),
    Product.countDocuments({ stock: { $lt: 10 } }),
  ]);
  res.json({ success: true, counts: { inquiries, tickets, orders, lowStock } });
}

// ——— Customers (accounts created from the Sign up form)
export async function listCustomers(req: Request, res: Response) {
  const { page, limit, skip } = paginate(req.query);
  const filter: Record<string, unknown> = { role: 'customer' };
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q)), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  const [users, total] = await Promise.all([User.find(filter).select('+pushTokens').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), User.countDocuments(filter)]);

  // An order belongs to a customer by account, email or phone (guest checkouts before signing up)
  const orders = await Order.find({ $or: [{ user: { $in: users.map((u) => u._id) } }, { 'customer.email': { $in: users.map((u) => u.email).filter(Boolean) } }, { 'customer.phone': { $in: users.map((u) => u.phone).filter(Boolean) } }] })
    .select('user customer total status createdAt')
    .lean();
  const items = users.map((u) => {
    const mine = orders.filter((o) => String(o.user) === String(u._id) || (u.email && o.customer?.email === u.email) || (u.phone && o.customer?.phone === u.phone));
    const { pushTokens, ...rest } = u;
    return {
      ...rest,
      pushDevices: pushTokens?.length ?? 0,
      orders: mine.length,
      spent: mine.filter((o) => !['Cancelled', 'Payment Pending'].includes(o.status)).reduce((t, o) => t + o.total, 0),
      lastOrder: mine.reduce<Date | undefined>((d, o) => (!d || o.createdAt > d ? o.createdAt : d), undefined),
    };
  });
  res.json({ success: true, items, total, page, limit });
}

export async function getCustomer(req: Request, res: Response) {
  const found = await User.findById(req.params.id).select('+pushTokens').lean();
  if (!found || found.role !== 'customer') throw new ApiError(404, 'Customer not found.');
  const { pushTokens, ...user } = found;
  const match: Record<string, unknown>[] = [{ user: user._id }];
  if (user.email) match.push({ 'customer.email': user.email });
  if (user.phone) match.push({ 'customer.phone': user.phone });
  const orders = await Order.find({ $or: match }).sort({ createdAt: -1 });
  const spent = orders.filter((o) => !['Cancelled', 'Payment Pending'].includes(o.status)).reduce((s, o) => s + o.total, 0);
  // Delivery addresses the customer has used (newest first, de-duplicated)
  const seen = new Set<string>();
  const addresses = orders
    .map((o) => ({ ...o.address, name: o.customer?.name, phone: o.customer?.phone, email: o.customer?.email, usedAt: (o as unknown as { createdAt: Date }).createdAt }))
    .filter((a) => { const k = `${a.line1}|${a.pincode}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  res.json({
    success: true,
    customer: {
      ...user,
      googleLinked: Boolean(user.googleId),
      notifyOffers: user.notifyOffers !== false,
      pushDevices: (pushTokens ?? []).map((t) => ({ device: t.device, addedAt: t.addedAt })),
    },
    addresses,
    stats: { orders: orders.length, spent, lastOrder: orders[0] ? (orders[0] as unknown as { createdAt: Date }).createdAt : null },
    orders: orders.map((o) => ({ id: o.orderId, total: o.total, status: o.status, date: (o as unknown as { createdAt: Date }).createdAt, items: o.items.length })),
  });
}

export async function setBlocked(req: Request, res: Response) {
  const user = await User.findOneAndUpdate({ _id: req.params.id, role: 'customer' }, { isBlocked: !!req.body.isBlocked }, { new: true });
  if (!user) throw new ApiError(404, 'Customer not found.');
  res.json({ success: true, customer: user });
}
