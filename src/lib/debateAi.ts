/**
 * Debate AI: in dev, uses dedicated API server at http://localhost:8081 (run: npm run debate-ai-proxy).
 * Same-origin only when not in dev or when VITE_DEBATE_AI_SAME_ORIGIN=1.
 */
const DEV_DEBATE_AI_URL = 'http://localhost:8081/api/debate-ai';

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

function getApiUrl(): string {
  const env = (import.meta as any).env;
  if (env?.VITE_DEBATE_AI_SAME_ORIGIN === '1') {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/api/debate-ai`;
  }
  // Production (Vercel): set VITE_DEBATE_AI_API_URL to your Render API URL
  const apiBase = env?.VITE_DEBATE_AI_API_URL as string | undefined;
  if (apiBase) {
    const base = apiBase.replace(/\/$/, '');
    return `${base}/api/debate-ai`;
  }
  const proxyBase = env?.VITE_DEBATE_AI_PROXY_URL as string | undefined;
  if (proxyBase) {
    const base = proxyBase.replace(/\/$/, '');
    return `${base}/api/debate-ai`;
  }
  if (typeof import.meta.env?.DEV !== 'undefined' && import.meta.env.DEV) {
    return DEV_DEBATE_AI_URL;
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/api/debate-ai`;
}

export async function invokeDebateAI(body: DebateAIBody): Promise<{ data: unknown; error: Error | null }> {
  const url = getApiUrl();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        (data && typeof data === 'object' && ('error' in data ? (data as any).error : (data as any).message)) ||
        `Request failed ${res.status}`;
      return { data: null, error: new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)) };
    }
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
