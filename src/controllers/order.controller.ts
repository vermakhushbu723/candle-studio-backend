import type { Request, Response } from 'express';
import { Coupon } from '../models/Engagement.js';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { User } from '../models/User.js';
import { getShippingSettings, shippingFor } from '../models/Setting.js';
import { notifyOrder, type OrderEvent } from '../services/notify.js';
import { ApiError, escapeRegex, paginate } from '../utils/http.js';
import { evaluateCoupon } from './coupon.controller.js';
import { env } from '../config/env.js';
import { isValidPaymentSignature, razorpay } from '../config/razorpay.js';


type OrderDoc = InstanceType<typeof Order>;

async function newOrderId() {
  for (;;) {
    const id = `CD${Math.floor(100000 + Math.random() * 900000)}`;
    if (!(await Order.exists({ orderId: id }))) return id;
  }
}

/** Shape the website and admin understand (id = public order number). */
export const toClientOrder = (o: OrderDoc) => ({
  id: o.orderId,
  _id: o._id,
  date: (o as unknown as { createdAt: Date }).createdAt,
  customer: o.customer,
  address: o.address,
  items: o.items,
  subtotal: o.subtotal,
  discount: o.discount,
  shipping: o.shipping,
  total: o.total,
  couponCode: o.couponCode,
  giftNote: o.giftNote,
  status: o.status,
  statusHistory: o.statusHistory,
  paymentMethod: o.paymentMethod,
  paymentStatus: o.paymentStatus,
  courier: o.courier,
  awb: o.awb,
  razorpayPaymentId: o.razorpayPaymentId,
});

/** Checkout form → order. Prices, discount and shipping are always recomputed from the database. */
export async function createOrder(req: Request, res: Response) {
  const b = req.body;
  const products = await Product.find({ slug: { $in: b.items.map((i: { productId: string }) => i.productId) }, isActive: true });
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const items = b.items.map((i: { productId: string; quantity: number; fragrance?: string | null }) => {
    const p = bySlug.get(i.productId);
    if (!p) throw new ApiError(400, 'An item in your cart is no longer available. Please remove it and try again.');
    if (p.stock < i.quantity) throw new ApiError(400, `Only ${p.stock} of “${p.name}” left in stock.`);
    return { productId: p.slug, name: p.name, image: p.images[0], price: p.price, quantity: i.quantity, fragrance: i.fragrance ?? undefined };
  });

  const subtotal = items.reduce((s: number, i: { price: number; quantity: number }) => s + i.price * i.quantity, 0);
  let discount = 0;
  let couponId: unknown;
  if (b.couponCode) {
    const r = await evaluateCoupon(b.couponCode, subtotal, req.user?.id);
    discount = r.discount;
    couponId = r.coupon._id;
  }
  const after = subtotal - discount;
  // Shipping charges are set by the admin (Settings → Shipping charges)
  const shipping = shippingFor(after, await getShippingSettings());

  const online = b.payment !== 'cod';
  const rzp = razorpay();
  if (online && !rzp) throw new ApiError(503, 'Online payment is not available right now. Please choose Cash on Delivery.');

  const firstStatus = online ? 'Payment Pending' : 'Order Placed';
  const order = (await Order.create({
    orderId: await newOrderId(),
    user: req.user?.id,
    customer: { name: b.fullName, phone: b.phone, email: b.email },
    address: { line1: b.line1, city: b.city, state: b.state, pincode: b.pincode },
    items,
    subtotal,
    discount,
    shipping,
    total: after + shipping,
    couponCode: couponId ? b.couponCode : undefined,
    giftNote: b.giftNote || undefined,
    paymentMethod: b.payment,
    paymentStatus: 'Pending',
    status: firstStatus,
    statusHistory: [{ status: firstStatus, at: new Date() }],
  })) as OrderDoc;

  if (!online) {
    await commitStock(order);
    void notifyOrder(order, 'placed');
    return res.status(201).json({ success: true, order: toClientOrder(order) });
  }

  // Online: open a Razorpay order; stock and coupon are only taken once the payment is verified
  try {
    const rp = await rzp!.orders.create({
      amount: order.total * 100, // paise
      currency: 'INR',
      receipt: order.orderId,
      notes: { orderId: order.orderId, customer: order.customer!.name },
    });
    order.razorpayOrderId = rp.id;
    await order.save();
  } catch (e) {
    await order.deleteOne();
    console.error('Razorpay order create failed:', e);
    throw new ApiError(502, 'Could not start the online payment. Please try again or choose Cash on Delivery.');
  }
  res.status(201).json({ success: true, order: toClientOrder(order), razorpay: checkoutOptions(order) });
}

/** What the website passes to Razorpay Checkout. */
const checkoutOptions = (o: OrderDoc) => ({
  key: env.razorpayKeyId,
  orderId: o.razorpayOrderId,
  amount: o.total * 100,
  currency: 'INR',
  method: o.paymentMethod, // upi | card — opens that tab first
  prefill: { name: o.customer?.name, email: o.customer?.email, contact: `+91${o.customer?.phone}` },
});

/** Takes stock and counts coupon usage exactly once per order. */
async function commitStock(order: OrderDoc) {
  if (order.stockCommitted) return;
  await Promise.all([
    ...order.items.map((i) => Product.updateOne({ slug: i.productId }, { $inc: { stock: -i.quantity, soldCount: i.quantity } })),
    order.couponCode ? Coupon.updateOne({ code: order.couponCode }, { $inc: { usedCount: 1 } }) : null,
  ]);
  order.stockCommitted = true;
  await order.save();
}

/** Razorpay Checkout success handler → verify the signature, then confirm the order. */
export async function verifyPayment(req: Request, res: Response) {
  const order = (await Order.findOne({ orderId: req.params.orderId })) as OrderDoc | null;
  if (!order || !order.razorpayOrderId) throw new ApiError(404, 'Order not found.');
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (order.paymentStatus === 'Paid') return res.json({ success: true, order: toClientOrder(order) }); // already confirmed
  if (razorpay_order_id !== order.razorpayOrderId || !isValidPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    throw new ApiError(400, 'Payment could not be verified. If money was debited, it will be refunded automatically.');
  }
  await markPaid(order, razorpay_payment_id);
  res.json({ success: true, order: toClientOrder(order) });
}

/** Confirms an online order once Razorpay says it is paid (checkout handler or webhook — whichever comes first). */
export async function markPaid(order: OrderDoc, paymentId: string, via = 'checkout') {
  if (order.paymentStatus === 'Paid') return;
  const wasPending = order.status === 'Payment Pending';
  order.paymentStatus = 'Paid';
  order.razorpayPaymentId = paymentId;
  order.paidAt = new Date();
  if (order.status === 'Payment Pending') {
    order.status = 'Order Placed';
    order.statusHistory.push({ status: 'Order Placed', at: new Date(), note: `Paid online · ${paymentId}${via === 'webhook' ? ' (webhook)' : ''}` });
  }
  await order.save();
  await commitStock(order);
  if (wasPending) void notifyOrder(order, 'paid');
}

/** Lets the website reopen Razorpay Checkout for an order whose payment was not completed. */
export async function retryPayment(req: Request, res: Response) {
  const order = (await Order.findOne({ orderId: req.params.orderId })) as OrderDoc | null;
  if (!order || !order.razorpayOrderId || order.status !== 'Payment Pending') throw new ApiError(404, 'There is no pending payment for this order.');
  res.json({ success: true, order: toClientOrder(order), razorpay: checkoutOptions(order) });
}

const digits = (s: string) => s.replace(/\D/g, '').slice(-10);

/** Track Order form: order ID + the phone or email used at checkout. */
export async function trackOrder(req: Request, res: Response) {
  const notFound = new ApiError(404, 'We couldn’t find an order with those details.');
  const order = (await Order.findOne({ orderId: new RegExp(`^${escapeRegex(req.params.orderId.trim())}$`, 'i') })) as OrderDoc | null;
  if (!order) throw notFound;
  const contact = String(req.query.contact ?? '').trim().toLowerCase();
  const matches = contact === order.customer?.email || (digits(contact).length === 10 && digits(contact) === order.customer?.phone);
  if (!matches) throw notFound;
  res.json({ success: true, order: toClientOrder(order) });
}

export async function myOrders(req: Request, res: Response) {
  const me = await User.findById(req.user!.id);
  const match: Record<string, unknown>[] = [{ user: req.user!.id }];
  if (me?.email) match.push({ 'customer.email': me.email });
  if (me?.phone) match.push({ 'customer.phone': me.phone });
  const orders = (await Order.find({ $or: match }).sort({ createdAt: -1 })) as OrderDoc[];
  res.json({ success: true, orders: orders.map(toClientOrder) });
}

// ——— Admin
export async function listOrders(req: Request, res: Response) {
  const { page, limit, skip } = paginate(req.query);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.payment) filter.paymentMethod = req.query.payment;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q)), 'i');
    filter.$or = [{ orderId: rx }, { 'customer.name': rx }, { 'customer.email': rx }, { 'customer.phone': rx }, { 'address.city': rx }];
  }
  const [items, total] = await Promise.all([Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), Order.countDocuments(filter)]);
  res.json({ success: true, items: (items as OrderDoc[]).map(toClientOrder), total, page, limit });
}

export async function getOrder(req: Request, res: Response) {
  const order = (await Order.findOne({ orderId: req.params.orderId }).populate('user', 'name email phone')) as OrderDoc | null;
  if (!order) throw new ApiError(404, 'Order not found.');
  res.json({ success: true, order: { ...toClientOrder(order), account: order.user } });
}

export async function updateStatus(req: Request, res: Response) {
  const order = (await Order.findOne({ orderId: req.params.orderId })) as OrderDoc | null;
  if (!order) throw new ApiError(404, 'Order not found.');
  const { status, note, awb, courier, paymentStatus } = req.body;
  const previous = order.status;
  if (status !== order.status) order.statusHistory.push({ status, at: new Date(), note });
  // Put stock back when an order is cancelled (and take it again if it is revived)
  if (status !== order.status && order.stockCommitted && (status === 'Cancelled' || order.status === 'Cancelled')) {
    const sign = status === 'Cancelled' ? 1 : -1;
    await Promise.all(order.items.map((i) => Product.updateOne({ slug: i.productId }, { $inc: { stock: sign * i.quantity, soldCount: -sign * i.quantity } })));
  }
  order.status = status;
  if (awb !== undefined) order.awb = awb;
  if (courier) order.courier = courier;
  if (paymentStatus) order.paymentStatus = paymentStatus;
  if (status === 'Delivered' && order.paymentMethod === 'cod') order.paymentStatus = 'Paid';
  await order.save();
  // Admin confirmed an online order by hand (e.g. payment checked in the Razorpay dashboard)
  if (!['Cancelled', 'Payment Pending'].includes(status)) await commitStock(order);
  // Tell the customer about every real status change
  if (status !== previous) {
    const event: OrderEvent | null = status === 'Order Placed' ? (previous === 'Payment Pending' ? 'placed' : null) : status === 'Payment Pending' ? null : (status as OrderEvent);
    if (event) void notifyOrder(order, event);
  }
  res.json({ success: true, order: toClientOrder(order) });
}
