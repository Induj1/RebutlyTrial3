/**
 * Vercel serverless proxy for Supabase Edge Function debate-ai.
 * Same-origin request from the app avoids CORS (no need to set Allowed Origins in Supabase).
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !ANON_KEY) {
    return res.status(500).json({
      error: 'debate-ai proxy not configured',
      hint: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_URL and SUPABASE_ANON_KEY) in Vercel Environment Variables.',
    });
  }

  const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/debate-ai`;
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});

  try {
    const fnRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body,
    });

    const data = await fnRes.json().catch(() => ({}));
    res.status(fnRes.status).json(data);
  } catch (err) {
    console.error('[debate-ai proxy]', err);
    res.status(502).json({ error: err.message || 'Failed to reach debate-ai' });
  }
}
