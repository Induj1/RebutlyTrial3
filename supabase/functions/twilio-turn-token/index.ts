import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TwilioTokenResponse {
  ice_servers?: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
}

const app = new Hono();

app.options("*", () => new Response(null, { headers: corsHeaders }));

app.post("/", async (c) => {
  try {
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const ttlRaw = Deno.env.get("TWILIO_TURN_TTL_SECONDS") ?? "3600";
    const ttl = Math.max(300, Math.min(86400, Number.parseInt(ttlRaw, 10) || 3600));

    if (!accountSid || !authToken) {
      return c.json(
        { error: "Twilio TURN is not configured on the server" },
        500,
        corsHeaders,
      );
    }

    const formData = new URLSearchParams();
    formData.set("Ttl", String(ttl));

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Tokens.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[twilio-turn-token] Twilio token request failed:", response.status, errorText);
      return c.json({ error: "Failed to mint TURN token" }, 502, corsHeaders);
    }

    const data = (await response.json()) as TwilioTokenResponse;
    const iceServers = data.ice_servers ?? [];

    if (!iceServers.length) {
      return c.json({ error: "No ICE servers returned by Twilio" }, 502, corsHeaders);
    }

    return c.json({ iceServers }, 200, corsHeaders);
  } catch (error) {
    console.error("[twilio-turn-token] Unexpected error:", error);
    return c.json({ error: "Internal server error" }, 500, corsHeaders);
  }
});

Deno.serve(app.fetch);
