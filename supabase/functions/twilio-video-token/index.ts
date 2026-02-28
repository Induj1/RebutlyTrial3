import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const app = new Hono();

app.options("*", () => new Response(null, { headers: corsHeaders }));

const base64UrlEncode = (input: string | Uint8Array): string => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const signHmacSha256 = async (message: string, secret: string): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(signature);
};

app.post("/", async (c) => {
  try {
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const apiKeySid = Deno.env.get("TWILIO_API_KEY_SID");
    const apiKeySecret = Deno.env.get("TWILIO_API_KEY_SECRET");
    const ttlRaw = Deno.env.get("TWILIO_VIDEO_TTL_SECONDS") ?? "3600";
    const ttl = Math.max(300, Math.min(21600, Number.parseInt(ttlRaw, 10) || 3600));

    if (!accountSid || !apiKeySid || !apiKeySecret) {
      return c.json(
        { error: "Twilio Video is not configured on the server" },
        500,
        corsHeaders,
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const roomName = typeof body?.roomName === "string" ? body.roomName.trim() : "";
    const identity = typeof body?.identity === "string" ? body.identity.trim() : "";

    if (!roomName || !identity) {
      return c.json({ error: "roomName and identity are required" }, 400, corsHeaders);
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      jti: `${apiKeySid}-${crypto.randomUUID()}`,
      iss: apiKeySid,
      sub: accountSid,
      exp: now + ttl,
      nbf: now - 1,
      iat: now,
      grants: {
        identity,
        video: {
          room: roomName,
        },
      },
    };

    const encodedHeader = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = await signHmacSha256(signingInput, apiKeySecret);
    const token = `${signingInput}.${base64UrlEncode(signature)}`;

    return c.json({ token }, 200, corsHeaders);
  } catch (error) {
    console.error("[twilio-video-token] Unexpected error:", error);
    return c.json({ error: "Internal server error" }, 500, corsHeaders);
  }
});

Deno.serve(app.fetch);
