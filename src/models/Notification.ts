import { Schema, model } from 'mongoose';

/** History of customer broadcasts (manual from the admin, or automatic for new products / offers / collections). */
const notificationSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    link: { type: String, default: '' },
    image: { type: String, default: '' },
    channels: { type: [String], enum: ['push', 'email'], default: ['push'] },
    trigger: { type: String, enum: ['manual', 'new-product', 'new-offer', 'new-collection'], default: 'manual' },
    status: { type: String, enum: ['sending', 'sent', 'failed'], default: 'sending' },
    stats: {
      customers: { type: Number, default: 0 },
      pushSent: { type: Number, default: 0 },
      pushFailed: { type: Number, default: 0 },
      emailSent: { type: Number, default: 0 },
      emailFailed: { type: Number, default: 0 },
    },
    error: String,
    createdBy: String,
  },
  { timestamps: true },
);

export const Notification = model('Notification', notificationSchema);
