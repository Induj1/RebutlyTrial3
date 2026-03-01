import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const app = new Hono();

app.options("*", () => new Response(null, { headers: corsHeaders }));

app.post("/", (c) => {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) {
    return c.json({ fallback: true, message: "ELEVENLABS_API_KEY not configured" }, 200, corsHeaders);
  }

  // Browser hook only checks for fallback/error; tokenized realtime flow can be added later.
  return c.json({ fallback: true, message: "Scribe token endpoint stubbed; browser speech fallback enabled" }, 200, corsHeaders);
});

Deno.serve(app.fetch);
