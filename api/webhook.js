import { createClerkClient } from '@clerk/backend';
import crypto from 'crypto';

// Initialize Clerk
const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Verify the webhook signature from Lemon Squeezy
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  
  // NOTE: Depending on how Vercel parses the body, we might need the raw body. 
  // For simplicity, if we skip signature verification (not recommended for prod),
  // we just process the payload. Here we show how it should be done:
  const hmac = crypto.createHmac('sha256', secret);
  const digest = Buffer.from(hmac.update(JSON.stringify(req.body)).digest('hex'), 'utf8');
  const signature = Buffer.from(req.headers['x-signature'] || '', 'utf8');

  try {
    if (signature.length !== digest.length || !crypto.timingSafeEqual(digest, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch (error) {
    return res.status(401).json({ error: 'Signature verification failed' });
  }

  // 2. Parse the payload
  const eventName = req.body.meta.event_name;
  
  if (eventName === 'order_created') {
    // 3. Extract the user_id that we passed in the custom checkout data
    const userId = req.body.data.attributes.custom_data?.user_id;

    if (userId) {
      try {
        // 4. Update the user's public metadata in Clerk
        await clerkClient.users.updateUserMetadata(userId, {
          publicMetadata: {
            hasPaid: true,
          }
        });
        console.log(`Successfully upgraded user ${userId}`);
        return res.status(200).json({ success: true });
      } catch (error) {
        console.error('Error updating Clerk user:', error);
        return res.status(500).json({ error: 'Failed to update user in Clerk' });
      }
    } else {
      console.warn('Order created but no user_id found in custom_data');
      return res.status(400).json({ error: 'Missing user_id' });
    }
  }

  // Acknowledge other events without action
  return res.status(200).json({ success: true, message: 'Event ignored' });
}
