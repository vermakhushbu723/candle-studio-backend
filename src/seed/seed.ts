/**
 * Seeds the `candlestudio` database with the storefront catalogue and demo data for the admin.
 * Usage: npm run seed            (wipes & reseeds every Jyotessa collection)
 */
import { readFileSync } from 'node:fs';
import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { Collection } from '../models/Collection.js';
import { Coupon, Inquiry, Ticket } from '../models/Engagement.js';
import { Order, PAYMENT_METHODS } from '../models/Order.js';
import { Otp } from '../models/Otp.js';
import { Product } from '../models/Product.js';
import { User } from '../models/User.js';
import { discountFor } from '../controllers/coupon.controller.js';

const productsJson = JSON.parse(readFileSync(new URL('./products.json', import.meta.url), 'utf8'));

const daysAgo = (d: number) => new Date(Date.now() - d * 86400000 - Math.floor(Math.random() * 36e6));
const pick = <T>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];

const customers = [
  { name: 'Ananya Sharma', email: 'ananya.sharma@example.com', phone: '9810012345', city: 'Noida', state: 'Uttar Pradesh', pincode: '201301' },
  { name: 'Rohit Mehra', email: 'rohit.mehra@example.com', phone: '9876501234', city: 'Gurugram', state: 'Haryana', pincode: '122002' },
  { name: 'Priya Kapoor', email: 'priya.kapoor@example.com', phone: '9911223344', city: 'New Delhi', state: 'Delhi', pincode: '110017' },
  { name: 'Sneha Rao', email: 'sneha.rao@example.com', phone: '9845098450', city: 'Bengaluru', state: 'Karnataka', pincode: '560034' },
  { name: 'Karan Singh', email: 'karan.singh@example.com', phone: '9829012345', city: 'Jaipur', state: 'Rajasthan', pincode: '302001' },
  { name: 'Meera Thakur', email: 'meera.thakur@example.com', phone: '9820098200', city: 'Mumbai', state: 'Maharashtra', pincode: '400050' },
  { name: 'Aditi Verma', email: 'aditi.verma@example.com', phone: '9717171717', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226010' },
  { name: 'Vikram Nair', email: 'vikram.nair@example.com', phone: '9447012345', city: 'Kochi', state: 'Kerala', pincode: '682020' },
  { name: 'Ishita Bose', email: 'ishita.bose@example.com', phone: '9830098300', city: 'Kolkata', state: 'West Bengal', pincode: '700019' },
  { name: 'Arjun Malhotra', email: 'arjun.malhotra@example.com', phone: '9999012345', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
];
const fragranceIds = ['sandalwood', 'lavender', 'jasmine', 'oud'];
const FLOW = ['Order Placed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered'] as const;

async function seed() {
  await connectDB();
  console.log('Clearing collections…');
  const models = [User, Product, Order, Inquiry, Ticket, Coupon, Collection, Otp] as unknown as (typeof User)[];
  // Drop (not just empty) so index changes — e.g. sparse email/phone — are rebuilt
  await Promise.all(models.map((M) => M.collection.drop().catch(() => undefined)));
  await Promise.all(models.map((M) => M.syncIndexes()));

  // Admin + customers (passwords hashed by the model hook)
  await User.create({ name: 'Studio Admin', email: env.adminEmail, password: env.adminPassword, role: 'admin' });
  const users = [];
  for (const [i, c] of customers.entries()) {
    users.push(await User.create({ name: c.name, email: c.email, phone: c.phone, lastLoginAt: daysAgo(i), createdAt: daysAgo(120 - i * 9) }));
  }
  console.log(`Users: 1 admin + ${users.length} customers`);

  const products = await Product.insertMany(productsJson.map((p: { reviews: number }) => ({ ...p, soldCount: Math.round(p.reviews / 4) })));
  console.log(`Products: ${products.length}`);

  const collections = [
    { slug: 'diwali-special', name: 'Diwali Collection', type: 'festive', description: 'Diyas, urlis and mithai-inspired candles for the festival of lights.', image: '/images/products/festive-diya-set-1.webp', tone: '#F5E1C0' },
    { slug: 'valentine-special', name: 'Valentine Collection', type: 'festive', description: 'Hearts, roses and candles made for two.', image: '/images/products/together-forever-1.jpg', tone: '#F6DDD6' },
    { slug: 'christmas-special', name: 'Christmas Collection', type: 'festive', description: 'Cosy, spiced and gift-wrapped for the holidays.', image: '/images/products/dry-fruit-delight-1.webp', tone: '#E9E2D2' },
    { slug: 'new-year-special', name: 'New Year Collection', type: 'festive', description: 'Sparkle for countdowns and fresh starts.', image: '/images/products/kit-duo.webp', tone: '#ECE4D6' },
    { slug: 'winter', name: 'Winter Collection', type: 'curated', description: 'Chai, rasmalai and warm spices for chilly evenings.', image: '/images/products/chai-parle-g-candle-2.jpg', tone: '#E8E1DA' },
    { slug: 'spiritual', name: 'Spiritual', type: 'curated', description: 'Lotus, diya and urli candles for pooja corners.', image: '/images/products/lotus-pond-candle-1.jpg', tone: '#F2E8D5' },
    { slug: 'ocean', name: 'Ocean', type: 'curated', description: 'Shells, sand and sea-breeze calm.', image: '/images/products/extra-beach-1.jpg', tone: '#DDEBEE' },
    { slug: 'aesthetic', name: 'Aesthetic', type: 'curated', description: 'Sculpted candles that double as decor.', image: '/images/products/elegant-lady-candle-1.jpg', tone: '#EFE6DD' },
    { slug: 'cartoons-kids', name: 'Cartoons & Kids', type: 'curated', description: 'Playful shapes kids love (lit only by grown-ups!).', image: '/images/products/heart-teddy-candle-2.jpg', tone: '#FCE9D8' },
  ];
  await Collection.insertMany(collections.map((c, i) => ({ ...c, sortOrder: i })));
  console.log(`Collections: ${collections.length}`);

  const coupons = [
    { code: 'GLOW10', type: 'percent', value: 10, expiry: new Date('2027-12-31'), description: '10% off your first order' },
    { code: 'PEARL15', type: 'percent', value: 15, minOrder: 999, maxDiscount: 400, expiry: new Date('2027-12-31'), description: '15% off pearled kits above ₹999' },
    { code: 'DIWALI200', type: 'fixed', value: 200, minOrder: 1499, expiry: new Date('2026-11-15'), usageLimit: 300, description: '₹200 off festive orders above ₹1,499' },
    { code: 'MONSOON20', type: 'percent', value: 20, expiry: new Date('2026-08-31'), isActive: false, description: 'Monsoon sale (ended)' },
  ];
  await Coupon.insertMany(coupons);

  // ~55 orders spread across the last 90 days; older orders are further along
  const orders = [];
  for (let n = 0; n < 55; n++) {
    const ui = Math.floor(Math.random() * users.length);
    const u = users[ui];
    const c = customers[ui];
    const lines = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => pick(products));
    const items = lines.map((p) => ({
      productId: p.slug, name: p.name, image: p.images[0], price: p.price, quantity: 1 + Math.floor(Math.random() * 2),
      fragrance: p.fragrances ? pick(fragranceIds) : undefined,
    }));
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const coupon = Math.random() > 0.7 ? coupons[0] : undefined;
    const discount = coupon ? discountFor(coupon, subtotal) : 0;
    const after = subtotal - discount;
    const shipping = after >= 899 ? 0 : 79;
    const age = Math.floor((n / 55) * 90);
    const cancelled = Math.random() < 0.06;
    const stage = cancelled ? 0 : Math.min(FLOW.length - 1, Math.floor(age / 2));
    const status = cancelled ? 'Cancelled' : FLOW[stage];
    const created = daysAgo(age);
    const paymentMethod = pick(PAYMENT_METHODS);
    orders.push({
      orderId: `CD${String(104500 + n * 37)}`,
      user: u._id,
      customer: { name: c.name, phone: c.phone, email: c.email },
      address: { line1: `${12 + ui}, Green Park Residency, Sector ${20 + ui}`, city: c.city, state: c.state, pincode: c.pincode },
      items,
      subtotal,
      discount,
      shipping,
      total: after + shipping,
      couponCode: coupon?.code,
      giftNote: Math.random() > 0.8 ? 'Happy Diwali! Love, from all of us.' : undefined,
      status,
      statusHistory: [
        ...FLOW.slice(0, stage + 1).map((s, i) => ({ status: s, at: new Date(created.getTime() + i * 86400000) })),
        ...(cancelled ? [{ status: 'Cancelled', at: new Date(created.getTime() + 3600000), note: 'Cancelled by customer' }] : []),
      ],
      paymentMethod,
      paymentStatus: cancelled ? (paymentMethod === 'cod' ? 'Pending' : 'Refunded') : paymentMethod !== 'cod' || status === 'Delivered' ? 'Paid' : 'Pending',
      stockCommitted: true,
      awb: stage >= 2 && !cancelled ? `SR${700000000 + n * 7919}` : undefined,
      createdAt: created,
      updatedAt: created,
    });
  }
  await Order.insertMany(orders);
  console.log(`Orders: ${orders.length}`);

  await Inquiry.insertMany([
    { name: 'Neha Gupta', email: 'neha.g@example.com', phone: '9811122233', topic: 'bulk', message: 'We need 150 pearled shot-glass combos as Diwali gifts for our team. Can you share bulk pricing and timelines?', createdAt: daysAgo(0) },
    { name: 'Rahul Jain', email: 'rahul.jain@example.com', phone: '9876123456', topic: 'order', message: 'My order CD104537 shows packed for two days — when will it be shipped?', createdAt: daysAgo(1) },
    { name: 'Sana Khan', email: 'sana.k@example.com', topic: 'custom', message: 'Can you make a custom hamper with the Rasmalai and Jalebi candles plus a handwritten card for my sister’s wedding?', status: 'In progress', notes: [{ by: 'Studio Admin', text: 'Shared hamper options on WhatsApp.', at: daysAgo(2) }], createdAt: daysAgo(3) },
    { name: 'Pooja Iyer', email: 'pooja.iyer@example.com', phone: '9840011223', topic: 'bulk', message: 'Looking for 200 mini pocket magic kits as wedding return gifts in December. Please share a quote.', createdAt: daysAgo(2) },
    { name: 'Dev Arora', email: 'dev.arora@example.com', topic: 'other', message: 'Do you run candle-making workshops? Would love to book one for a birthday party.', status: 'Resolved', createdAt: daysAgo(9) },
  ]);

  await Ticket.insertMany([
    { ticketId: 'CD-482913', name: 'Kavya Reddy', phone: '9849012345', topic: 'Order issue', message: 'The lid of my Ocean Escape kit arrived cracked.', createdAt: daysAgo(0) },
    { ticketId: 'CD-371204', name: 'Manish Gupta', phone: '9811023456', topic: 'Bulk / corporate gifting', message: 'Need 80 festive diya sets with our logo on the box.', status: 'In progress', createdAt: daysAgo(2) },
    { ticketId: 'CD-293817', name: 'Simran Kaur', phone: '9876012345', topic: 'Product question', message: 'Are the pearls safe to use around cats?', status: 'Resolved', notes: [{ by: 'Studio Admin', text: 'Called back — explained soy wax is non-toxic, keep flame away from pets.', at: daysAgo(4) }], createdAt: daysAgo(5) },
    { ticketId: 'CD-184420', name: 'Aakash Jain', phone: '9910098765', topic: 'Custom hamper', message: 'Want an anniversary hamper with Together Forever + Heart Bowl candle.', createdAt: daysAgo(1) },
  ]);

  console.log('Coupons, enquiries & chat tickets seeded.');
  console.log(`\nAdmin login    → ${env.adminEmail} / ${env.adminPassword}`);
  console.log('Customer login → phone 9810012345 + OTP (dev mode: OTP is printed by the API and shown on the login page)');
  await disconnectDB();
}

seed().catch(async (err) => {
  console.error(err);
  await disconnectDB();
  process.exit(1);
});
