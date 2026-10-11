import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as admin from '../controllers/admin.controller.js';
import * as auth from '../controllers/auth.controller.js';
import * as collections from '../controllers/collection.controller.js';
import * as coupons from '../controllers/coupon.controller.js';
import * as inbox from '../controllers/inbox.controller.js';
import * as orders from '../controllers/order.controller.js';
import * as products from '../controllers/product.controller.js';
import * as settings from '../controllers/settings.controller.js';
import { requireAdmin } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import * as s from '../validators/schemas.js';
import { asyncHandler as h } from '../utils/http.js';

const router = Router();

router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }), validate(s.loginSchema), h(auth.adminLogin));

// Everything below needs an admin token
router.use(requireAdmin);

router.get('/me', h(auth.me));
router.put('/me', validate(s.profileSchema), h(auth.updateMe));
router.put('/password', validate(s.passwordSchema), h(auth.changePassword));

router.get('/dashboard', h(admin.dashboard));
router.get('/counts', h(admin.counts));

// Orders
router.get('/orders', h(orders.listOrders));
router.get('/orders/:orderId', h(orders.getOrder));
router.patch('/orders/:orderId/status', validate(s.orderStatusSchema), h(orders.updateStatus));

// Products
router.get('/products', h(products.listAdmin));
router.get('/products/:id', h(products.getById));
router.post('/products', validate(s.productSchema), h(products.create));
router.put('/products/:id', validate(s.productSchema.partial()), h(products.update));
router.delete('/products/:id', h(products.remove));

// Collections (Diwali, Valentine, Winter…)
router.get('/collections', h(collections.listAdmin));
router.get('/collections/:id', h(collections.getOne));
router.post('/collections', validate(s.collectionSchema), h(collections.create));
router.put('/collections/:id', validate(s.collectionSchema.partial()), h(collections.update));
router.delete('/collections/:id', h(collections.remove));

// Customers
router.get('/customers', h(admin.listCustomers));
router.get('/customers/:id', h(admin.getCustomer));
router.patch('/customers/:id/block', h(admin.setBlocked));

// Inbox: contact enquiries + chatbot tickets
for (const [path, ctrl] of [['inquiries', inbox.inquiryAdmin], ['tickets', inbox.ticketAdmin]] as const) {
  router.get(`/${path}`, h(ctrl.list));
  router.get(`/${path}/:id`, h(ctrl.get));
  router.patch(`/${path}/:id`, validate(s.statusNoteSchema), h(ctrl.update));
  router.delete(`/${path}/:id`, h(ctrl.remove));
}

// Store settings
router.get('/settings/shipping', h(settings.getShipping));
router.put('/settings/shipping', validate(s.shippingSettingsSchema), h(settings.updateShipping));

// Coupons
router.get('/coupons', h(coupons.listAll));
router.post('/coupons', validate(s.couponSchema), h(coupons.create));
router.put('/coupons/:id', validate(s.couponSchema.partial()), h(coupons.update));
router.delete('/coupons/:id', h(coupons.remove));

export default router;
