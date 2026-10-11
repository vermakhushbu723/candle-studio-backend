import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as auth from '../controllers/auth.controller.js';
import * as collections from '../controllers/collection.controller.js';
import * as coupons from '../controllers/coupon.controller.js';
import * as inbox from '../controllers/inbox.controller.js';
import * as notifications from '../controllers/notification.controller.js';
import * as orders from '../controllers/order.controller.js';
import * as products from '../controllers/product.controller.js';
import * as settings from '../controllers/settings.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import * as s from '../validators/schemas.js';
import { asyncHandler as h } from '../utils/http.js';

const router = Router();

// Throttle credential and form endpoints against brute force / spam
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false });
const formLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

// ——— Login page: phone + OTP, or Google
router.post('/auth/otp/send', authLimiter, validate(s.otpSendSchema), h(auth.sendOtp));
router.post('/auth/otp/verify', authLimiter, validate(s.otpVerifySchema), h(auth.verifyOtp));
router.post('/auth/google', authLimiter, validate(s.googleSchema), h(auth.googleLogin));
router.get('/auth/me', requireAuth, h(auth.me));
router.put('/auth/me', requireAuth, validate(s.profileSchema), h(auth.updateMe));
router.put('/auth/password', requireAuth, validate(s.passwordSchema), h(auth.changePassword));

// ——— Catalogue
router.get('/products', h(products.listPublic));
router.get('/products/:slug', h(products.getBySlug));
router.get('/collections', h(collections.listPublic));
router.get('/settings', h(settings.publicSettings));

// ——— Checkout, coupon box, Track Order
router.post('/coupons/validate', formLimiter, validate(s.couponCheckSchema), h(coupons.validateCoupon));
// Customers must be logged in to place an order (the checkout asks them to log in first)
router.post('/orders', formLimiter, requireAuth, validate(s.createOrderSchema), h(orders.createOrder));
router.post('/orders/:orderId/verify-payment', formLimiter, validate(s.verifyPaymentSchema), h(orders.verifyPayment));
router.post('/orders/:orderId/retry-payment', formLimiter, h(orders.retryPayment));
router.get('/orders/mine', requireAuth, h(orders.myOrders));
router.get('/orders/track/:orderId', authLimiter, h(orders.trackOrder));

// ——— Push notifications + preferences (logged-in customers)
router.post('/notifications/devices', requireAuth, validate(s.deviceSchema), h(notifications.addDevice));
router.delete('/notifications/devices', requireAuth, validate(s.deviceSchema), h(notifications.removeDevice));
router.get('/notifications/preferences', requireAuth, h(notifications.getPreferences));
router.put('/notifications/preferences', requireAuth, validate(s.preferencesSchema), h(notifications.setPreferences));

// ——— Contact form + support chatbot form
router.post('/inquiries', formLimiter, validate(s.inquirySchema), h(inbox.createInquiry));
router.post('/tickets', formLimiter, validate(s.ticketSchema), h(inbox.createTicket));

export default router;
