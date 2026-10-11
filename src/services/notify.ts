/**
 * Customer notifications — push (Firebase) + email (SMTP). Never throws: a failed notification
 * must not break an order or an admin action, so callers fire-and-forget with `void notify…()`.
 *
 * Order updates (always sent, to the customer of the order):
 *   placed · paid · Packed · Shipped · Out for Delivery · Delivered · Cancelled
 * Broadcasts (only customers with notifyOffers = true):
 *   new product · new offer/coupon · new collection (when the admin ticks "Notify customers") · manual message
 */
import { env } from '../config/env.js';
import { Notification } from '../models/Notification.js';
import { Order } from '../models/Order.js';
import { User } from '../models/User.js';
import { emailLayout, mailEnabled, sendMail } from './mail.js';
import { pushEnabled, sendPush, type PushMessage } from './push.js';

type OrderDoc = InstanceType<typeof Order>;
export type OrderEvent = 'placed' | 'paid' | 'Packed' | 'Shipped' | 'Out for Delivery' | 'Delivered' | 'Cancelled';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const first = (name?: string) => (name ?? '').split(' ')[0] || 'there';

function orderMessage(o: OrderDoc, event: OrderEvent) {
  const name = first(o.customer?.name);
  const id = `#${o.orderId}`;
  const items = o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ');
  const contact = o.customer?.email || o.customer?.phone || '';
  const trackLink = `/track-order?order=${o.orderId}&contact=${encodeURIComponent(contact)}`;
  const m: Record<OrderEvent, { title: string; body: string; lines: string[] }> = {
    placed: {
      title: 'Order confirmed 🕯️',
      body: `Hi ${name}, your order ${id} (${rupees(o.total)}) is confirmed. We’ll tell you when it ships.`,
      lines: [`Hi ${name}, thank you for shopping with Jyotessa!`, `Your order ${id} is confirmed: ${items}.`, `Total: ${rupees(o.total)} · Payment: ${o.paymentMethod.toUpperCase()}`, 'We’ll send you another update as soon as it ships.'],
    },
    paid: {
      title: 'Payment received — order confirmed 🕯️',
      body: `Hi ${name}, we received ${rupees(o.total)} for order ${id}. It’s being prepared now.`,
      lines: [`Hi ${name}, your payment of ${rupees(o.total)} was successful.`, `Order ${id}: ${items}.`, 'We’re preparing your candles and will update you when they ship.'],
    },
    Packed: {
      title: 'Your order is packed 📦',
      body: `Order ${id} is packed and will be handed to the courier shortly.`,
      lines: [`Hi ${name}, good news — order ${id} is packed and ready to ship.`],
    },
    Shipped: {
      title: 'Your order has shipped 🚚',
      body: `Order ${id} is on its way${o.awb ? ` · AWB ${o.awb}` : ''}.`,
      lines: [`Hi ${name}, order ${id} has shipped via ${o.courier ?? 'our courier partner'}.`, ...(o.awb ? [`Tracking (AWB) number: ${o.awb}`] : [])],
    },
    'Out for Delivery': {
      title: 'Out for delivery today ✨',
      body: `Order ${id} will reach you today. Keep your phone handy!`,
      lines: [`Hi ${name}, order ${id} is out for delivery and should reach you today.`, ...(o.paymentMethod === 'cod' ? [`Please keep ${rupees(o.total)} ready for Cash on Delivery.`] : [])],
    },
    Delivered: {
      title: 'Delivered — enjoy the glow! 🎉',
      body: `Order ${id} has been delivered. We hope you love it!`,
      lines: [`Hi ${name}, order ${id} has been delivered.`, 'We hope it brings a little warmth to your home. Tag us on Instagram — we love seeing your setups!'],
    },
    Cancelled: {
      title: 'Order cancelled',
      body: `Order ${id} has been cancelled.${o.paymentStatus === 'Paid' || o.paymentStatus === 'Refunded' ? ' Any payment will be refunded in 5–7 working days.' : ''}`,
      lines: [`Hi ${name}, order ${id} has been cancelled.`, ...(o.paymentMethod !== 'cod' && o.paymentStatus !== 'Pending' ? ['Your refund will reach the original payment method in 5–7 working days.'] : []), 'If this wasn’t expected, just reply to this email and we’ll help.'],
    },
  };
  return { ...m[event], link: trackLink };
}

async function tokensFor(userIds: unknown[]) {
  const users = await User.find({ _id: { $in: userIds } }).select('+pushTokens');
  return users.flatMap((u) => (u.pushTokens ?? []).map((t) => t.token));
}

/** Order status updates → the order's customer (push to their devices + email). */
export async function notifyOrder(order: OrderDoc, event: OrderEvent) {
  try {
    const msg = orderMessage(order, event);
    const tokens = order.user ? await tokensFor([order.user]) : [];
    await Promise.all([
      sendPush(tokens, { title: msg.title, body: msg.body, link: msg.link }),
      order.customer?.email
        ? sendMail(order.customer.email, `${msg.title.replace(/\s*\p{Extended_Pictographic}/gu, '')} · Order #${order.orderId}`, emailLayout({ heading: msg.title, lines: msg.lines, button: { label: 'Track your order', url: env.siteUrl + msg.link } }))
        : null,
      // Team alert for every new order
      (event === 'placed' || event === 'paid') && env.adminNotifyEmail
        ? sendMail(env.adminNotifyEmail, `New order #${order.orderId} · ${rupees(order.total)}`, emailLayout({
            heading: `New order #${order.orderId}`,
            lines: [`${order.customer?.name} · ${order.customer?.phone} · ${order.address?.city}`, order.items.map((i) => `${i.quantity} × ${i.name}`).join(', '), `Total ${rupees(order.total)} · ${order.paymentMethod.toUpperCase()} · ${order.paymentStatus}`],
            button: { label: 'Open in admin', url: `${env.siteUrl.replace('://', '://admin.')}/orders/${order.orderId}` },
          }))
        : null,
    ]);
  } catch (e) {
    console.error('[notify] order', order.orderId, event, (e as Error).message);
  }
}

export interface Broadcast extends PushMessage {
  channels: ('push' | 'email')[];
  trigger?: 'manual' | 'new-product' | 'new-offer' | 'new-collection';
  createdBy?: string;
}

/** Sends a marketing message to every opted-in customer. Returns the history record immediately; delivery continues in the background. */
export async function broadcast(b: Broadcast) {
  const record = await Notification.create({ title: b.title, body: b.body, link: b.link ?? '', image: b.image ?? '', channels: b.channels, trigger: b.trigger ?? 'manual', createdBy: b.createdBy });
  void (async () => {
    try {
      const customers = await User.find({ role: 'customer', isBlocked: false, notifyOffers: { $ne: false } }).select('+pushTokens email name');
      const stats = { customers: customers.length, pushSent: 0, pushFailed: 0, emailSent: 0, emailFailed: 0 };
      if (b.channels.includes('push')) {
        const r = await sendPush(customers.flatMap((c) => (c.pushTokens ?? []).map((t) => t.token)), b);
        stats.pushSent = r.sent;
        stats.pushFailed = r.failed;
      }
      if (b.channels.includes('email')) {
        const url = b.link ? (b.link.startsWith('http') ? b.link : env.siteUrl + b.link) : env.siteUrl;
        for (const c of customers.filter((x) => x.email)) {
          const ok = await sendMail(c.email!, b.title, emailLayout({ heading: b.title, lines: [`Hi ${first(c.name)},`, b.body], button: { label: 'Shop now', url }, footer: 'You’re receiving this because you have a Jyotessa account. You can turn off offer updates from your account page.' }));
          if (ok) stats.emailSent++;
          else stats.emailFailed++;
        }
      }
      await Notification.updateOne({ _id: record._id }, { status: 'sent', stats });
    } catch (e) {
      await Notification.updateOne({ _id: record._id }, { status: 'failed', error: (e as Error).message });
    }
  })();
  return record;
}

export const channelStatus = () => ({ push: pushEnabled(), email: mailEnabled() });
