import twilio from 'twilio';

/**
 * Vercel Serverless Function: Mint Twilio Video access tokens.
 * Same-origin call avoids CORS. Requires TWILIO_* env vars in Vercel.
 * If missing, proxies to Supabase Edge Function.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // GET = diagnostic (check if Twilio env vars are visible)
  if (req.method === 'GET') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
    return res.status(200).json({
      configured: !!(accountSid && apiKeySid && apiKeySecret),
      env: { TWILIO_ACCOUNT_SID: !!accountSid, TWILIO_API_KEY_SID: !!apiKeySid, TWILIO_API_KEY_SECRET: !!apiKeySecret },
      hint: !accountSid || !apiKeySid || !apiKeySecret ? 'Add vars in Vercel → Settings → Environment Variables, then redeploy.' : 'OK',
    });
  }

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
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://uvjclnbkhpfryqpwjjmo.supabase.co';
    const auth = req.headers.authorization;
    if (auth) {
      try {
        const fnRes = await fetch(`${supabaseUrl}/functions/v1/twilio-video-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: auth },
          body: JSON.stringify({ roomName, identity }),
        });
        const data = await fnRes.json().catch(() => ({}));
        if (fnRes.ok && data.token) return res.status(200).json(data);
        const msg = data?.error || `Supabase returned ${fnRes.status}`;
        console.error('[twilio-token] Supabase proxy error:', fnRes.status, msg);
        return res.status(500).json({ error: msg });
      } catch (e) {
        console.error('[twilio-token] Supabase proxy failed:', e);
        return res.status(500).json({ error: `Proxy failed: ${e.message}` });
      }
    }
    console.error('[twilio-token] No Authorization header - user may not be logged in');
    return res.status(401).json({ error: 'Not authenticated. Please sign in.' });
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
