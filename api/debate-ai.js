/**
 * Vercel serverless proxy for Debate AI. Forwards to Render (or Supabase fallback).
 * Same-origin /api/debate-ai avoids CORS; set DEBATE_AI_API_URL in Vercel to your Render URL.
 */
const RENDER_API_URL =
  process.env.DEBATE_AI_API_URL ||
  process.env.VITE_DEBATE_AI_API_URL ||
  '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      message: 'Debate AI proxy. POST here; forwards to Render or Supabase.',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});

  // Prefer Render backend
  if (RENDER_API_URL) {
    const url = `${RENDER_API_URL.replace(/\/$/, '')}/api/debate-ai`;
    try {
      const out = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const text = await out.text();
      const data = text ? JSON.parse(text) : {};
      res.status(out.status).json(data);
    } catch (err) {
      console.error('[debate-ai proxy] Render', err);
      res.status(502).json({ error: err.message || 'Failed to reach Debate AI' });
    }
    return;
  }

  // Fallback: Supabase Edge Function
  if (SUPABASE_URL && ANON_KEY) {
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/debate-ai`;
    try {
      const out = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body,
      });
      const data = await out.json().catch(() => ({}));
      res.status(out.status).json(data);
    } catch (err) {
      console.error('[debate-ai proxy] Supabase', err);
      res.status(502).json({ error: err.message || 'Failed to reach debate-ai' });
    }
    return;
  }

  res.status(500).json({
    error: 'Debate AI not configured',
    hint: 'Set DEBATE_AI_API_URL (e.g. https://rebutly-debate-ai-api.onrender.com) in Vercel Environment Variables.',
  });
}
