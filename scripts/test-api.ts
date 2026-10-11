/**
 * End-to-end API check against a running server.
 *   npm run dev          (in one terminal)
 *   npm run test:api     (in another)
 * Exercises every public + admin endpoint (one per website form) and cleans up what it creates.
 */
import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Order } from '../src/models/Order.js';
import { User } from '../src/models/User.js';

const BASE = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 5050}/api`;
let passed = 0;
let failed = 0;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m — ${(e as Error).message}`);
  }
}

function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log(`Testing ${BASE}\n`);
  const stamp = Date.now();
  const testPhone = `9${String(stamp).slice(-9)}`; // unique per run
  const email = `test.${stamp}@example.com`;
  let token = '';
  let adminToken = '';
  let product = { id: '', _id: '', price: 0, name: '', stock: 0 };
  let orderId = '';
  const created: Record<string, string> = {};

  console.log('Health & catalogue');
  await check('GET /health', async () => {
    const r = await call('GET', '/health');
    expect(r.status === 200 && r.json.db === 'connected', `status ${r.status}, db ${r.json.db}`);
  });
  await check('GET /products', async () => {
    const r = await call('GET', '/products');
    expect(r.status === 200 && r.json.products.length > 0, 'no products');
    product = r.json.products.find((p: { stock: number }) => p.stock > 5);
    expect(product.id && product._id, 'product is missing id/_id');
  });
  await check('GET /products/:slug', async () => {
    const r = await call('GET', `/products/${product.id}`);
    expect(r.status === 200 && r.json.product.id === product.id, `status ${r.status}`);
  });
  await check('GET /products/:slug (404)', async () => {
    const r = await call('GET', '/products/does-not-exist');
    expect(r.status === 404, `status ${r.status}`);
  });

  console.log('\nForm: Login (phone + OTP, Google)');
  let otp = '';
  await check('POST /auth/otp/send (new number)', async () => {
    const r = await call('POST', '/auth/otp/send', { phone: testPhone });
    expect(r.status === 200 && r.json.isNewUser === true && /^\d{6}$/.test(r.json.devOtp), `status ${r.status} ${r.json.message}`);
    otp = r.json.devOtp;
  });
  await check('POST /auth/otp/send (resend within 30s → 429)', async () => {
    const r = await call('POST', '/auth/otp/send', { phone: testPhone });
    expect(r.status === 429, `status ${r.status}`);
  });
  await check('POST /auth/otp/send (invalid phone → 400)', async () => {
    const r = await call('POST', '/auth/otp/send', { phone: '12345' });
    expect(r.status === 400, `status ${r.status}`);
  });
  await check('POST /auth/otp/verify (wrong OTP → 400)', async () => {
    const r = await call('POST', '/auth/otp/verify', { phone: testPhone, otp: otp === '111111' ? '222222' : '111111', name: 'Test Buyer' });
    expect(r.status === 400, `status ${r.status}`);
  });
  await check('POST /auth/otp/verify (new user without name → 400)', async () => {
    const r = await call('POST', '/auth/otp/verify', { phone: testPhone, otp });
    expect(r.status === 400 && /name/.test(r.json.message), `status ${r.status} ${r.json.message}`);
  });
  await check('POST /auth/otp/verify (creates account)', async () => {
    const r = await call('POST', '/auth/otp/verify', { phone: testPhone, otp, name: 'Test Buyer', email });
    expect(r.status === 201 && r.json.token && r.json.user.phone === testPhone, `status ${r.status} ${r.json.message}`);
    token = r.json.token;
  });
  await check('OTP is single-use', async () => {
    const r = await call('POST', '/auth/otp/verify', { phone: testPhone, otp });
    expect(r.status === 400, `status ${r.status}`);
  });
  await check('POST /auth/google (bad token → 401/503)', async () => {
    const r = await call('POST', '/auth/google', { credential: 'x'.repeat(40) });
    expect(r.status === 401 || r.status === 503, `status ${r.status}`);
  });
  await check('old password endpoints are gone', async () => {
    const r = await call('POST', '/auth/login', { email, password: 'x' });
    expect(r.status === 404, `status ${r.status}`);
  });
  await check('GET /auth/me', async () => {
    const r = await call('GET', '/auth/me', undefined, token);
    expect(r.status === 200 && r.json.user.phone === testPhone, `status ${r.status}`);
  });
  await check('GET /auth/me (no token → 401)', async () => {
    const r = await call('GET', '/auth/me');
    expect(r.status === 401, `status ${r.status}`);
  });

  console.log('\nForm: Coupon box + Checkout');
  await check('POST /coupons/validate (GLOW10)', async () => {
    const r = await call('POST', '/coupons/validate', { code: 'glow10', subtotal: 1000 });
    expect(r.status === 200 && r.json.discount === 100 && r.json.coupon.type === 'percent', `status ${r.status} discount ${r.json.discount}`);
  });
  await check('POST /coupons/validate (unknown → 404)', async () => {
    const r = await call('POST', '/coupons/validate', { code: 'NOPE', subtotal: 1000 });
    expect(r.status === 404, `status ${r.status}`);
  });
  await check('POST /coupons/validate (inactive → 404)', async () => {
    const r = await call('POST', '/coupons/validate', { code: 'MONSOON20', subtotal: 1000 });
    expect(r.status === 404, `status ${r.status}`);
  });
  const orderBody = () => ({
    items: [{ productId: product.id, quantity: 2, fragrance: 'lavender' }],
    fullName: 'Test Buyer', phone: testPhone, email, line1: '12 Test Street, Sector 5', city: 'Noida', state: 'Uttar Pradesh', pincode: '201301',
    giftNote: 'API test', payment: 'cod', couponCode: 'GLOW10',
  });
  await check('POST /orders (server prices + coupon + shipping)', async () => {
    const r = await call('POST', '/orders', orderBody(), token);
    expect(r.status === 201, `status ${r.status} ${r.json.message}`);
    const o = r.json.order;
    const sub = product.price * 2;
    const disc = Math.round(sub * 0.1);
    const ship = sub - disc >= 899 ? 0 : 79;
    expect(o.subtotal === sub && o.discount === disc && o.total === sub - disc + ship, `got ${o.subtotal}/${o.discount}/${o.total}`);
    expect(/^CD\d{6}$/.test(o.id), `order id ${o.id}`);
    orderId = o.id;
  });
  await check('POST /orders (bad pincode → 400)', async () => {
    const r = await call('POST', '/orders', { ...orderBody(), pincode: '12' });
    expect(r.status === 400, `status ${r.status}`);
  });
  await check('POST /orders (unknown product → 400)', async () => {
    const r = await call('POST', '/orders', { ...orderBody(), items: [{ productId: 'ghost', quantity: 1 }] });
    expect(r.status === 400, `status ${r.status}`);
  });
  await check('stock decremented', async () => {
    const r = await call('GET', `/products/${product.id}`);
    expect(r.json.product.stock === product.stock - 2, `stock ${r.json.product.stock}, expected ${product.stock - 2}`);
  });
  console.log('\nRazorpay');
  const rzpConfigured = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  if (!rzpConfigured) {
    await check('online payment without keys → 503 (choose COD)', async () => {
      const r = await call('POST', '/orders', { ...orderBody(), payment: 'upi' }, token);
      expect(r.status === 503, `status ${r.status}`);
    });
    console.log('  (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set in .env — live gateway checks skipped)');
  } else {
    let payOrder = '';
    let rzpOrderId = '';
    await check('POST /orders (UPI) creates a Razorpay order', async () => {
      const r = await call('POST', '/orders', { ...orderBody(), payment: 'upi' }, token);
      expect(r.status === 201 && r.json.razorpay?.orderId?.startsWith('order_'), `status ${r.status} ${r.json.message}`);
      expect(r.json.order.status === 'Payment Pending' && r.json.razorpay.amount === r.json.order.total * 100, 'wrong status/amount');
      payOrder = r.json.order.id;
      rzpOrderId = r.json.razorpay.orderId;
    });
    await check('verify-payment rejects a forged signature', async () => {
      const r = await call('POST', `/orders/${payOrder}/verify-payment`, { razorpay_order_id: rzpOrderId, razorpay_payment_id: 'pay_fake', razorpay_signature: 'deadbeef' });
      expect(r.status === 400, `status ${r.status}`);
    });
    await check('retry-payment returns checkout options', async () => {
      const r = await call('POST', `/orders/${payOrder}/retry-payment`);
      expect(r.status === 200 && r.json.razorpay.orderId === rzpOrderId, `status ${r.status}`);
    });
    await check('verify-payment with a valid signature marks it Paid', async () => {
      const paymentId = `pay_test${stamp}`;
      const sig = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!).update(`${rzpOrderId}|${paymentId}`).digest('hex');
      const r = await call('POST', `/orders/${payOrder}/verify-payment`, { razorpay_order_id: rzpOrderId, razorpay_payment_id: paymentId, razorpay_signature: sig });
      expect(r.status === 200 && r.json.order.paymentStatus === 'Paid' && r.json.order.status === 'Order Placed', `status ${r.status} ${r.json.message}`);
    });
    created.payOrder = payOrder;

    await check('Razorpay has the order with the right amount (live API)', async () => {
      const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const r = await fetch(`https://api.razorpay.com/v1/orders/${rzpOrderId}`, { headers: { Authorization: `Basic ${auth}` } });
      const o = (await r.json()) as { amount?: number; receipt?: string; currency?: string };
      expect(r.ok && o.receipt === payOrder && o.currency === 'INR' && (o.amount ?? 0) > 0, `status ${r.status} ${JSON.stringify(o).slice(0, 120)}`);
    });

    if (process.env.RAZORPAY_WEBHOOK_SECRET) {
      let hookOrder = '';
      let hookRzpOrder = '';
      const hook = (body: object, secret = process.env.RAZORPAY_WEBHOOK_SECRET!) => {
        const raw = JSON.stringify(body);
        return fetch(`${BASE}/payments/razorpay/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': createHmac('sha256', secret).update(raw).digest('hex') },
          body: raw,
        });
      };
      await check('webhook: unsigned/forged event → 400', async () => {
        const r = await hook({ event: 'payment.captured', payload: {} }, 'wrong-secret');
        expect(r.status === 400, `status ${r.status}`);
      });
      await check('webhook: payment.captured confirms an unpaid order', async () => {
        const c = await call('POST', '/orders', { ...orderBody(), payment: 'card', couponCode: undefined }, token);
        expect(c.status === 201, `create ${c.status} ${c.json.message}`);
        hookOrder = c.json.order.id;
        hookRzpOrder = c.json.razorpay.orderId;
        const r = await hook({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_hook${stamp}`, order_id: hookRzpOrder, status: 'captured' } } } });
        expect(r.status === 200, `webhook ${r.status}`);
        const t = await call('GET', `/orders/track/${hookOrder}?contact=${encodeURIComponent(email)}`);
        expect(t.json.order.status === 'Order Placed' && t.json.order.paymentStatus === 'Paid', `status ${t.json.order.status}/${t.json.order.paymentStatus}`);
      });
      await check('webhook + checkout handler both arriving is harmless (idempotent)', async () => {
        const r = await hook({ event: 'order.paid', payload: { payment: { entity: { id: `pay_hook${stamp}`, order_id: hookRzpOrder, status: 'captured' } } } });
        const t = await call('GET', `/orders/track/${hookOrder}?contact=${encodeURIComponent(email)}`);
        expect(r.status === 200 && t.json.order.statusHistory.filter((h: { status: string }) => h.status === 'Order Placed').length === 1, 'duplicate history');
      });
      created.hookOrder = hookOrder;
    }
  }

  console.log('\nCollections');
  await check('GET /collections', async () => {
    const r = await call('GET', '/collections');
    const diwali = r.json.collections?.find((c: { id: string }) => c.id === 'diwali-special');
    expect(r.status === 200 && diwali && diwali.productCount > 0, `status ${r.status}`);
  });

  await check('GET /orders/mine', async () => {
    const r = await call('GET', '/orders/mine', undefined, token);
    expect(r.status === 200 && r.json.orders.some((o: { id: string }) => o.id === orderId), `status ${r.status}`);
  });

  console.log('\nForm: Track Order');
  await check('GET /orders/track/:id (email)', async () => {
    const r = await call('GET', `/orders/track/${orderId.toLowerCase()}?contact=${encodeURIComponent(email)}`);
    expect(r.status === 200 && r.json.order.id === orderId, `status ${r.status}`);
  });
  await check('GET /orders/track/:id (+91 phone)', async () => {
    const r = await call('GET', `/orders/track/${orderId}?contact=${encodeURIComponent(`+91 ${testPhone}`)}`);
    expect(r.status === 200, `status ${r.status}`);
  });
  await check('GET /orders/track/:id (wrong contact → 404)', async () => {
    const r = await call('GET', `/orders/track/${orderId}?contact=someone@else.com`);
    expect(r.status === 404, `status ${r.status}`);
  });

  console.log('\nForm: Contact + Chatbot');
  await check('POST /inquiries', async () => {
    const r = await call('POST', '/inquiries', { name: 'Test Person', email, phone: '9876543210', topic: 'bulk', message: 'API test enquiry — please ignore.' });
    expect(r.status === 201, `status ${r.status} ${r.json.message}`);
    created.inquiry = r.json.item._id;
  });
  await check('POST /inquiries (short message → 400)', async () => {
    const r = await call('POST', '/inquiries', { name: 'Test Person', email, message: 'hi' });
    expect(r.status === 400, `status ${r.status}`);
  });
  await check('POST /tickets', async () => {
    const r = await call('POST', '/tickets', { name: 'Test Person', phone: '9876543210', topic: 'Support', message: 'API test ticket' });
    expect(r.status === 201 && /^CD-\d{6}$/.test(r.json.ticketId), `status ${r.status} ${r.json.message}`);
    created.ticket = r.json.item._id;
  });

  console.log('\nAdmin');
  await check('POST /admin/login (customer → 401)', async () => {
    const r = await call('POST', '/admin/login', { email, password: 'anything' });
    expect(r.status === 401, `status ${r.status}`);
  });
  await check('POST /admin/login', async () => {
    const r = await call('POST', '/admin/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    expect(r.status === 200 && r.json.token, `status ${r.status} ${r.json.message}`);
    adminToken = r.json.token;
  });
  await check('GET /admin/dashboard (customer token → 403)', async () => {
    const r = await call('GET', '/admin/dashboard', undefined, token);
    expect(r.status === 403, `status ${r.status}`);
  });
  await check('GET /admin/dashboard', async () => {
    const r = await call('GET', '/admin/dashboard', undefined, adminToken);
    expect(r.status === 200 && r.json.cards.orders > 0 && r.json.charts.daily.length === 30, `status ${r.status}`);
  });
  await check('GET /admin/counts', async () => {
    const r = await call('GET', '/admin/counts', undefined, adminToken);
    expect(r.status === 200 && r.json.counts.inquiries >= 1 && r.json.counts.tickets >= 1, `status ${r.status}`);
  });
  await check('GET /admin/me', async () => {
    const r = await call('GET', '/admin/me', undefined, adminToken);
    expect(r.status === 200 && r.json.user.role === 'admin', `status ${r.status}`);
  });
  await check('GET /admin/orders?q=', async () => {
    const r = await call('GET', `/admin/orders?q=${orderId}`, undefined, adminToken);
    expect(r.status === 200 && r.json.total === 1, `status ${r.status} total ${r.json.total}`);
  });
  await check('GET /admin/orders/:id', async () => {
    const r = await call('GET', `/admin/orders/${orderId}`, undefined, adminToken);
    expect(r.status === 200 && r.json.order.account?.email === email, `status ${r.status}`);
  });
  await check('PATCH /admin/orders/:id/status → Shipped', async () => {
    const r = await call('PATCH', `/admin/orders/${orderId}/status`, { status: 'Shipped', awb: 'TESTAWB123', paymentStatus: 'Paid' }, adminToken);
    expect(r.status === 200 && r.json.order.status === 'Shipped' && r.json.order.awb === 'TESTAWB123', `status ${r.status}`);
  });
  await check('tracking reflects admin update', async () => {
    const r = await call('GET', `/orders/track/${orderId}?contact=${email}`);
    expect(r.json.order.status === 'Shipped' && r.json.order.statusHistory.length === 2, `status ${r.json.order.status}`);
  });
  await check('PATCH status → Cancelled restores stock', async () => {
    const before = (await call('GET', `/products/${product.id}`)).json.product.stock;
    await call('PATCH', `/admin/orders/${orderId}/status`, { status: 'Cancelled' }, adminToken);
    const r = await call('GET', `/products/${product.id}`);
    expect(r.json.product.stock === before + 2, `stock ${r.json.product.stock}, expected ${before + 2}`);
  });

  let collectionId = '';
  await check('POST /admin/collections (with products)', async () => {
    const r = await call('POST', '/admin/collections', { name: `Test Collection ${stamp}`, type: 'festive', productIds: [product.id] }, adminToken);
    expect(r.status === 201 && r.json.collection.slug === `test-collection-${stamp}`, `status ${r.status} ${r.json.message}`);
    collectionId = r.json.collection._id;
  });
  await check('collection is live with its product', async () => {
    const r = await call('GET', '/collections');
    const c = r.json.collections.find((x: { _id: string }) => x._id === collectionId);
    const p = await call('GET', `/products/${product.id}`);
    expect(c?.productCount === 1 && p.json.product.collections.includes(`test-collection-${stamp}`), 'product not in collection');
  });
  await check('PUT /admin/collections/:id (hide + empty)', async () => {
    const r = await call('PUT', `/admin/collections/${collectionId}`, { isActive: false, productIds: [] }, adminToken);
    const pub = await call('GET', '/collections');
    expect(r.status === 200 && !pub.json.collections.some((x: { _id: string }) => x._id === collectionId), `status ${r.status}`);
  });
  await check('DELETE /admin/collections/:id', async () => {
    const r = await call('DELETE', `/admin/collections/${collectionId}`, undefined, adminToken);
    const p = await call('GET', `/products/${product.id}`);
    expect(r.status === 200 && !p.json.product.collections.includes(`test-collection-${stamp}`), `status ${r.status}`);
  });

  let newProductId = '';
  await check('POST /admin/products', async () => {
    const r = await call('POST', '/admin/products', { name: `Test Candle ${stamp}`, line: 'handcrafted', category: 'floral', price: 499, compareAt: 599, stock: 5, images: ['/images/products/bouquet-candle-1.jpg'] }, adminToken);
    expect(r.status === 201 && r.json.product.id === `test-candle-${stamp}`, `status ${r.status} ${r.json.message}`);
    newProductId = r.json.product._id;
  });
  await check('new product is live on the website', async () => {
    const r = await call('GET', `/products/test-candle-${stamp}`);
    expect(r.status === 200 && r.json.product.visual.image, `status ${r.status}`);
  });
  await check('GET /admin/products?q=', async () => {
    const r = await call('GET', `/admin/products?q=${stamp}`, undefined, adminToken);
    expect(r.status === 200 && r.json.total === 1, `total ${r.json.total}`);
  });
  await check('PUT /admin/products/:id (hide)', async () => {
    const r = await call('PUT', `/admin/products/${newProductId}`, { price: 449, isActive: false }, adminToken);
    expect(r.status === 200 && r.json.product.price === 449, `status ${r.status}`);
    const pub = await call('GET', `/products/test-candle-${stamp}`);
    expect(pub.status === 404, 'hidden product still public');
  });
  await check('DELETE /admin/products/:id', async () => {
    const r = await call('DELETE', `/admin/products/${newProductId}`, undefined, adminToken);
    expect(r.status === 200, `status ${r.status}`);
  });

  await check('GET /admin/customers', async () => {
    const r = await call('GET', `/admin/customers?q=${encodeURIComponent(email)}`, undefined, adminToken);
    expect(r.status === 200 && r.json.items[0]?.orders >= 1, `status ${r.status}`);
    created.customer = r.json.items[0]._id;
  });
  await check('GET /admin/customers/:id', async () => {
    const r = await call('GET', `/admin/customers/${created.customer}`, undefined, adminToken);
    expect(r.status === 200 && r.json.orders.length >= 1, `status ${r.status}`);
  });
  await check('PATCH /admin/customers/:id/block', async () => {
    const r = await call('PATCH', `/admin/customers/${created.customer}/block`, { isBlocked: true }, adminToken);
    expect(r.status === 200 && r.json.customer.isBlocked, `status ${r.status}`);
    const back = await call('GET', '/auth/me', undefined, token);
    expect(back.status === 401, 'blocked user can still use token');
  });

  for (const [mod, id, status] of [['inquiries', created.inquiry, 'Resolved'], ['tickets', created.ticket, 'In progress']] as const) {
    await check(`GET /admin/${mod}`, async () => {
      const r = await call('GET', `/admin/${mod}?limit=5`, undefined, adminToken);
      expect(r.status === 200 && r.json.total > 0, `status ${r.status}`);
    });
    await check(`PATCH /admin/${mod}/:id`, async () => {
      const r = await call('PATCH', `/admin/${mod}/${id}`, { status, note: 'Handled by API test' }, adminToken);
      expect(r.status === 200 && r.json.item.status === status && r.json.item.notes.length === 1, `status ${r.status} ${r.json.message}`);
    });
  }

  let couponId = '';
  await check('POST /admin/coupons', async () => {
    const r = await call('POST', '/admin/coupons', { code: `TEST${stamp % 100000}`, type: 'fixed', value: 100, minOrder: 500, expiry: '2030-01-01', description: 'API test' }, adminToken);
    expect(r.status === 201, `status ${r.status} ${r.json.message}`);
    couponId = r.json.coupon._id;
  });
  await check('GET /admin/coupons', async () => {
    const r = await call('GET', '/admin/coupons', undefined, adminToken);
    expect(r.status === 200 && r.json.items.length > 0, `status ${r.status}`);
  });
  await check('PUT /admin/coupons/:id', async () => {
    const r = await call('PUT', `/admin/coupons/${couponId}`, { value: 150 }, adminToken);
    expect(r.status === 200 && r.json.coupon.value === 150, `status ${r.status}`);
  });
  await check('DELETE /admin/coupons/:id', async () => {
    const r = await call('DELETE', `/admin/coupons/${couponId}`, undefined, adminToken);
    expect(r.status === 200, `status ${r.status}`);
  });

  console.log('\nCleanup');
  await check('DELETE test enquiry + ticket', async () => {
    for (const [mod, id] of [['inquiries', created.inquiry], ['tickets', created.ticket]]) {
      const r = await call('DELETE', `/admin/${mod}/${id}`, undefined, adminToken);
      expect(r.status === 200, `${mod} delete ${r.status}`);
    }
  });
  await check('cancel paid test orders (returns their stock)', async () => {
    for (const id of [created.payOrder, created.hookOrder].filter(Boolean)) {
      const r = await call('PATCH', `/admin/orders/${id}/status`, { status: 'Cancelled', note: 'API test cleanup' }, adminToken);
      expect(r.status === 200, `${id} ${r.status}`);
    }
  });
  await check('DELETE test order + test customer (direct DB)', async () => {
    await connectDB();
    const [o, u] = await Promise.all([Order.deleteMany({ orderId: { $in: [orderId, created.payOrder, created.hookOrder].filter(Boolean) } }), User.deleteOne({ email })]);
    await disconnectDB();
    expect(o.deletedCount >= 1 && u.deletedCount === 1, `orders ${o.deletedCount}, users ${u.deletedCount}`);
  });
  await check('GET unknown route → 404', async () => {
    const r = await call('GET', '/nope');
    expect(r.status === 404, `status ${r.status}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
