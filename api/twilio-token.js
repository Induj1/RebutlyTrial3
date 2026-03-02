import twilio from 'twilio';

/**
 * Vercel Serverless Function: Mint Twilio Video access tokens.
 * Same-origin call avoids CORS. Requires TWILIO_* env vars in Vercel.
 * If missing, proxies to Supabase Edge Function.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const roomName = (body.roomName || '').trim();
  const identity = (body.identity || '').trim();
  if (!roomName || !identity) {
    return res.status(400).json({ error: 'roomName and identity are required' });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

  if (!accountSid || !apiKeySid || !apiKeySecret) {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const auth = req.headers.authorization;
    if (supabaseUrl && auth) {
      try {
        const fnRes = await fetch(`${supabaseUrl}/functions/v1/twilio-video-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: auth },
          body: JSON.stringify({ roomName, identity }),
        });
        const data = await fnRes.json();
        if (fnRes.ok && data.token) return res.status(200).json(data);
      } catch (e) {
        console.error('[twilio-token] Supabase proxy failed:', e);
      }
    }
    return res.status(500).json({ error: 'Twilio not configured. Add TWILIO_* to Vercel or configure Supabase.' });
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
