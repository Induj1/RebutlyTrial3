import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function base64UrlToString(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return atob(padded);
}

// Tries to derive the project ref from a Supabase anon JWT (payload has `ref`).
function deriveProjectRefFromAnonKey(anonKey?: string): string | null {
  if (!anonKey) return null;
  const parts = anonKey.split(".");
  if (parts.length < 2) return null;

  try {
    const payloadJson = base64UrlToString(parts[1]);
    const payload = JSON.parse(payloadJson) as { ref?: string };
    return payload.ref ?? null;
  } catch {
    return null;
  }
}

const ENV_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ENV_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const ENV_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;

const ref = ENV_PROJECT_ID || deriveProjectRefFromAnonKey(ENV_KEY) || null;
const url = ENV_URL || (ref ? `https://${ref}.supabase.co` : undefined);

// Create a mock client that returns empty results instead of crashing
function createMockClient(): SupabaseClient<Database> {
  const mockResponse = {
    data: null,
    error: { message: "Backend not connected", details: "", hint: "", code: "NOT_CONNECTED" },
    count: null,
    status: 503,
    statusText: "Service Unavailable",
  };

  const mockQueryBuilder = {
    select: () => mockQueryBuilder,
    insert: () => mockQueryBuilder,
    update: () => mockQueryBuilder,
    delete: () => mockQueryBuilder,
    eq: () => mockQueryBuilder,
    neq: () => mockQueryBuilder,
    gt: () => mockQueryBuilder,
    gte: () => mockQueryBuilder,
    lt: () => mockQueryBuilder,
    lte: () => mockQueryBuilder,
    like: () => mockQueryBuilder,
    ilike: () => mockQueryBuilder,
    is: () => mockQueryBuilder,
    in: () => mockQueryBuilder,
    contains: () => mockQueryBuilder,
    containedBy: () => mockQueryBuilder,
    range: () => mockQueryBuilder,
    order: () => mockQueryBuilder,
    limit: () => mockQueryBuilder,
    single: () => Promise.resolve(mockResponse),
    maybeSingle: () => Promise.resolve(mockResponse),
    then: (resolve: any) => resolve(mockResponse),
  };

  const mockAuth = {
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    signUp: () => Promise.resolve({ data: { user: null, session: null }, error: { message: "Backend not connected" } }),
    signInWithPassword: () => Promise.resolve({ data: { user: null, session: null }, error: { message: "Backend not connected" } }),
    signInWithOAuth: () => Promise.resolve({ data: { provider: null, url: null }, error: { message: "Backend not connected" } }),
    signOut: () => Promise.resolve({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  };

  const mockChannel = {
    on: () => mockChannel,
    subscribe: () => mockChannel,
  };

  const mockFunctions = {
    invoke: () => Promise.resolve({ data: null, error: { message: "Backend not connected" } }),
  };

  return {
    from: () => mockQueryBuilder,
    auth: mockAuth,
    channel: () => mockChannel,
    removeChannel: () => Promise.resolve("ok"),
    functions: mockFunctions,
  } as unknown as SupabaseClient<Database>;
}

// In dev, proxy Edge Function calls through Vite to avoid CORS (when Supabase Allowed Origins can't be changed)
function getFetch(): typeof fetch | undefined {
  if (import.meta.env.DEV && typeof window !== "undefined" && url?.includes("supabase.co")) {
    const supabaseOrigin = new URL(url).origin;
    return (input: RequestInfo | URL, init?: RequestInit) => {
      const reqUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (reqUrl.startsWith(supabaseOrigin + "/functions/v1/")) {
        const path = reqUrl.slice(supabaseOrigin.length); // /functions/v1/debate-ai
        const proxyUrl = `${window.location.origin}/api/supabase-functions${path}`;
        return fetch(proxyUrl, init);
      }
      return fetch(input, init);
    };
  }
  return undefined;
}

export const supabase: SupabaseClient<Database> = (() => {
  if (!url || !ENV_KEY) {
    console.warn("Supabase not configured - running in offline mode");
    return createMockClient();
  }

  const fetchOption = getFetch();
  return createClient<Database>(url, ENV_KEY, {
    global: fetchOption ? { fetch: fetchOption } : undefined,
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
})();

export const isSupabaseConfigured = Boolean(url && ENV_KEY);
