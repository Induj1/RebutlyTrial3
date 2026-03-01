import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_MALE_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID_MALE") ?? "EXAVITQu4vr4xnSDxMaL";
const DEFAULT_FEMALE_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID_FEMALE") ?? "21m00Tcm4TlvDq8ikWAM";

const app = new Hono();

app.options("*", () => new Response(null, { headers: corsHeaders }));

app.post("/", async (c) => {
  try {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      return c.json({ success: false, fallback: true, error: "ELEVENLABS_API_KEY not configured" }, 200, corsHeaders);
    }

    const body = await c.req.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const voiceGender = body?.voiceGender === "female" ? "female" : "male";

    if (!text) {
      return c.json({ success: false, error: "text is required" }, 400, corsHeaders);
    }

    const voiceId = voiceGender === "female" ? DEFAULT_FEMALE_VOICE_ID : DEFAULT_MALE_VOICE_ID;

    const elevenRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: Deno.env.get("ELEVENLABS_MODEL_ID") ?? "eleven_multilingual_v2",
      }),
    });

    if (!elevenRes.ok) {
      const errText = await elevenRes.text();
      console.error("[elevenlabs-tts] ElevenLabs error", errText);
      return c.json({ success: false, fallback: true, error: "ElevenLabs TTS failed" }, 200, corsHeaders);
    }

    const audioBuffer = await elevenRes.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(audioBuffer);
    for (let i = 0; i < bytes.byteLength; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }

    return c.json({ success: true, audioContent: btoa(binary) }, 200, corsHeaders);
  } catch (error) {
    console.error("[elevenlabs-tts] Unexpected error", error);
    return c.json({ success: false, fallback: true, error: "Internal server error" }, 200, corsHeaders);
  }
});

Deno.serve(app.fetch);
