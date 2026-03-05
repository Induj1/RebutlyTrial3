/**
 * Call debate-ai via same-origin /api/debate-ai (Vite proxy in dev, Vercel serverless in prod).
 * Avoids CORS by never calling Supabase from the browser.
 */

export type DebateAIBody = {
  type: 'opponent_response' | 'generate_feedback';
  topic: string;
  userSide: 'proposition' | 'opposition';
  phase: 'opening' | 'rebuttal' | 'closing';
  userArguments?: string[];
  aiArguments?: string[];
  speechDurationSeconds?: number;
  conversationHistory?: { role: string; content: string }[];
};

export async function invokeDebateAI(body: DebateAIBody): Promise<{ data: unknown; error: Error | null }> {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${base}/api/debate-ai`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = (data && (data.error || data.message)) || `Request failed ${res.status}`;
      if (res.status === 404) {
        msg =
          'Debate AI endpoint not found. Deploy the Supabase Edge Function: supabase functions deploy debate-ai';
      }
      return { data: null, error: new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)) };
    }
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
