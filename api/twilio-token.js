import twilio from 'twilio';

/**
 * Vercel Serverless Function: Mint Twilio Video access tokens.
 * Call from same origin to avoid CORS (unlike Supabase Edge Functions).
 *
 * Env vars required in Vercel:
 *   TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

  if (!accountSid || !apiKeySid || !apiKeySecret) {
    console.error('[twilio-token] Missing Twilio credentials');
    return res.status(500).json({ error: 'Twilio video is not configured' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const roomName = (body.roomName || '').trim();
  const identity = (body.identity || '').trim();

  if (!roomName || !identity) {
    return res.status(400).json({ error: 'roomName and identity are required' });
  }

  try {
    const VideoGrant = twilio.jwt.AccessToken.VideoGrant;
    const videoGrant = new VideoGrant({ room: roomName });

    const token = new twilio.jwt.AccessToken(accountSid, apiKeySid, apiKeySecret, {
      ttl: 3600,
      identity,
    });
    token.addGrant(videoGrant);

    return res.status(200).json({ token: token.toJwt() });
  } catch (err) {
    console.error('[twilio-token] Error:', err);
    return res.status(500).json({ error: 'Failed to create token' });
  }
}
