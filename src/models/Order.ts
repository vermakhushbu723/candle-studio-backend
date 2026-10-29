import { Schema, model } from 'mongoose';

// The five stages on the storefront's Track Order page, plus Cancelled.
// Online (Razorpay) orders wait in "Payment Pending" until the payment is verified.
export const ORDER_STATUSES = ['Payment Pending', 'Order Placed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'] as const;
export const PAYMENT_METHODS = ['upi', 'card', 'cod'] as const;

const itemSchema = new Schema(
  {
    productId: { type: String, required: true }, // product slug
    name: { type: String, required: true },
    image: String,
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    fragrance: String,
    color: String,
    pack: String, // e.g. "Pack of 2"
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    customer: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String, required: true, lowercase: true },
    },
    address: {
      line1: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
    },
    items: { type: [itemSchema], validate: (v: unknown[]) => v.length > 0 },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    total: { type: Number, required: true },
    couponCode: String,
    giftNote: String,
    status: { type: String, enum: ORDER_STATUSES, default: 'Order Placed', index: true },
    statusHistory: { type: [{ status: String, at: Date, note: String }], default: [] },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Refunded', 'Failed'], default: 'Pending' },
    razorpayOrderId: { type: String, index: true, sparse: true },
    razorpayPaymentId: String,
    paidAt: Date,
    stockCommitted: { type: Boolean, default: false }, // stock + coupon usage taken (COD at once, online after payment)
    courier: { type: String, default: 'Shiprocket · Delhivery' },
    awb: String,
  },
  { timestamps: true },
);

export const Order = model('Order', orderSchema);
