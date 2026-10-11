# Jyotessa API (candle-studio-backend)

Express + TypeScript + MongoDB API for the **candle-studio** website and the **candle-studio-admin** panel.

Database: `candlestudio` (same Atlas cluster as Velora Bloom, separate database — collections `users`, `products`, `collections`, `orders`, `inquiries`, `tickets`, `coupons`, `otps`).

## Run

```bash
npm install
cp .env.example .env    # fill MONGODB_URI + JWT_SECRET
npm run seed            # wipes & reseeds the candlestudio database
npm run dev             # http://localhost:5050/api
npm run test:api        # end-to-end test of every endpoint (server must be running)
```

Seed logins: admin `admin@candledust.in` / `Candle@2026` · customers sign in on the website with phone + OTP (e.g. 9810012345; with `OTP_DEV_MODE=true` the OTP is shown on the login page and in the server log).

Optional keys in `.env`: `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (online payments — without them only COD works), `GOOGLE_CLIENT_ID` (Google sign-in; also set `VITE_GOOGLE_CLIENT_ID` in the website).

Razorpay webhook (recommended, confirms orders even if the customer closes the tab after paying): Dashboard → Webhooks → URL `https://<your-api-domain>/api/payments/razorpay/webhook`, events `payment.captured`, `order.paid`, `payment.failed`, secret = `RAZORPAY_WEBHOOK_SECRET`. Razorpay can't reach `localhost`, so this only fires once the API is deployed (or tunnelled).

## Website forms → endpoints

| Website form | Endpoint | Admin page |
| --- | --- | --- |
| Login: phone + OTP | `POST /api/auth/otp/send`, `POST /api/auth/otp/verify` (new number → creates the account) | Customers |
| Login: Google | `POST /api/auth/google` (Google ID token) | Customers |
| Checkout (shipping + payment) | `POST /api/orders` — prices, coupon and shipping recomputed server-side. UPI/Card returns Razorpay options; `POST /api/orders/:id/verify-payment` checks the signature, `/retry-payment` reopens it | Orders |
| Coupon box (cart / checkout) | `POST /api/coupons/validate` | Coupons |
| Track Order | `GET /api/orders/track/:orderId?contact=<phone or email>` | Orders (status updates) |
| Contact → Send us a message | `POST /api/inquiries` | Contact Enquiries |
| Support chatbot → Leave us a message | `POST /api/tickets` (returns `CD-xxxxxx` ticket) | Chat Requests |

Collections (Diwali, Valentine, Winter…) are managed in the admin and served by `GET /api/collections`; products join them via `product.collections`.

The catalogue is served by `GET /api/products` (`id` = slug, same shape as `src/data/products.js`).

Admin endpoints live under `/api/admin/*` and need the token from `POST /api/admin/login`.
