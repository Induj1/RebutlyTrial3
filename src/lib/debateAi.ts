/**
 * Call debate-ai Edge Function. Prefers direct Supabase URL (works in dev without proxy);
 * falls back to same-origin /api/debate-ai for production (e.g. Vercel serverless).
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

function getDebateAIEndpoint(): { url: string; headers: Record<string, string> } {
  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
  const anonKey = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const base = supabaseUrl?.replace?.(/\/$/, '') ?? '';
  if (base && anonKey) {
    return {
      url: `${base}/functions/v1/debate-ai`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
      },
    };
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return {
    url: `${origin}/api/debate-ai`,
    headers: { 'Content-Type': 'application/json' },
  };
}

export async function invokeDebateAI(body: DebateAIBody): Promise<{ data: unknown; error: Error | null }> {
  const { url, headers } = getDebateAIEndpoint();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
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
