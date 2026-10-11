import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../config/env.js';
import { User } from '../models/User.js';

export interface PushMessage {
  title: string;
  body: string;
  link?: string; // absolute URL opened when the notification is tapped
  image?: string;
}

let ready: boolean | null = null;

/** Firebase Admin is initialised lazily from FIREBASE_SERVICE_ACCOUNT_BASE64; push is skipped when it is missing. */
export function pushEnabled() {
  if (ready !== null) return ready;
  ready = false;
  if (!env.firebaseServiceAccount) return ready;
  try {
    const sa = JSON.parse(Buffer.from(env.firebaseServiceAccount, 'base64').toString('utf8'));
    if (!getApps().length) initializeApp({ credential: cert(sa) });
    ready = true;
  } catch (e) {
    console.error('[push] invalid FIREBASE_SERVICE_ACCOUNT_BASE64:', (e as Error).message);
  }
  return ready;
}

const absolute = (url?: string) => (!url ? env.siteUrl : url.startsWith('http') ? url : env.siteUrl + url);

/** Sends one message to many device tokens (FCM limit: 500 per call). Removes tokens Firebase reports as dead. */
export async function sendPush(tokens: string[], msg: PushMessage) {
  const result = { sent: 0, failed: 0 };
  if (!tokens.length || !pushEnabled()) return result;
  const link = absolute(msg.link);
  const dead: string[] = [];

  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const res = await getMessaging().sendEachForMulticast({
      tokens: batch,
      notification: { title: msg.title, body: msg.body, ...(msg.image ? { imageUrl: absolute(msg.image) } : {}) },
      data: { link },
      webpush: {
        fcmOptions: { link },
        notification: { icon: `${env.siteUrl}/logo-mark.png`, badge: `${env.siteUrl}/logo-mark.png` },
      },
    });
    result.sent += res.successCount;
    result.failed += res.failureCount;
    res.responses.forEach((r, k) => {
      const code = r.error?.code ?? '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token') || code.includes('invalid-argument')) dead.push(batch[k]);
    });
  }
  if (dead.length) await User.updateMany({ 'pushTokens.token': { $in: dead } }, { $pull: { pushTokens: { token: { $in: dead } } } });
  return result;
}
