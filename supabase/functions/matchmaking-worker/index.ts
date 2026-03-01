import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type QueueEntry = {
  id: string;
  user_id: string;
  format: string;
  mode: string;
  region: string;
  elo: number;
  topic?: string | null;
};

const app = new Hono();

app.options("*", () => new Response(null, { headers: corsHeaders }));

app.post("/", async (c) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return c.json({ error: "Missing Supabase service role configuration" }, 500, corsHeaders);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await c.req.json().catch(() => ({}));
    const entryId = typeof body?.entryId === "string" ? body.entryId : null;

    if (entryId) {
      const { data: currentEntry } = await supabase
        .from("match_queue_entries")
        .select("id, user_id, format, mode, region, elo, topic, status")
        .eq("id", entryId)
        .eq("status", "waiting")
        .maybeSingle();

      if (!currentEntry) {
        return c.json({ matchFound: false, message: "Queue entry not waiting or not found" }, 200, corsHeaders);
      }

      const { data: candidates, error: candidatesError } = await supabase
        .from("match_queue_entries")
        .select("id, user_id, format, mode, region, elo, topic, joined_at")
        .eq("status", "waiting")
        .eq("format", currentEntry.format)
        .eq("mode", currentEntry.mode)
        .neq("user_id", currentEntry.user_id)
        .order("joined_at", { ascending: true });

      if (candidatesError) {
        console.error("[matchmaking-worker] Failed to load candidates", candidatesError);
        return c.json({ error: "Failed to load candidates" }, 500, corsHeaders);
      }

      const bestCandidate = (candidates ?? [])
        .map((candidate) => ({
          candidate,
          eloGap: Math.abs((candidate.elo ?? 1200) - (currentEntry.elo ?? 1200)),
        }))
        .sort((a, b) => a.eloGap - b.eloGap)[0]?.candidate as QueueEntry | undefined;

      if (!bestCandidate) {
        return c.json({ matchFound: false }, 200, corsHeaders);
      }

      const { data: room, error: roomError } = await supabase
        .from("debate_rooms")
        .insert({
          format: currentEntry.format,
          mode: currentEntry.mode,
          region: "global",
          status: "reserved",
          is_ai_opponent: false,
          topic: currentEntry.topic ?? bestCandidate.topic ?? null,
          hvh_format: "standard",
          current_phase: "waiting",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (roomError || !room) {
        console.error("[matchmaking-worker] Failed to create room", roomError);
        return c.json({ error: "Failed to create room" }, 500, corsHeaders);
      }

      const propositionFirst = Math.random() < 0.5;
      const participants = [
        {
          room_id: room.id,
          user_id: currentEntry.user_id,
          is_ai: false,
          role: propositionFirst ? "proposition" : "opposition",
          speaking_order: propositionFirst ? 1 : 2,
          connected_at: new Date().toISOString(),
        },
        {
          room_id: room.id,
          user_id: bestCandidate.user_id,
          is_ai: false,
          role: propositionFirst ? "opposition" : "proposition",
          speaking_order: propositionFirst ? 2 : 1,
          connected_at: new Date().toISOString(),
        },
      ];

      const { error: participantsError } = await supabase.from("debate_participants").insert(participants);
      if (participantsError) {
        console.error("[matchmaking-worker] Failed to insert participants", participantsError);
        return c.json({ error: "Failed to create participants" }, 500, corsHeaders);
      }

      const matchPayload = {
        status: "matched",
        matched_at: new Date().toISOString(),
        room_id: room.id,
        matched_with_user_id: bestCandidate.user_id,
      };

      const { error: updateFirstError } = await supabase
        .from("match_queue_entries")
        .update(matchPayload)
        .eq("id", currentEntry.id)
        .eq("status", "waiting");

      const { error: updateSecondError } = await supabase
        .from("match_queue_entries")
        .update({
          status: "matched",
          matched_at: new Date().toISOString(),
          room_id: room.id,
          matched_with_user_id: currentEntry.user_id,
        })
        .eq("id", bestCandidate.id)
        .eq("status", "waiting");

      if (updateFirstError || updateSecondError) {
        console.error("[matchmaking-worker] Failed to update queue entries", { updateFirstError, updateSecondError });
      }

      return c.json({ matchFound: true, roomId: room.id }, 200, corsHeaders);
    }

    return c.json({ matchFound: false, message: "No entryId provided" }, 200, corsHeaders);
  } catch (error) {
    console.error("[matchmaking-worker] Unexpected error", error);
    return c.json({ error: "Internal server error" }, 500, corsHeaders);
  }
});

Deno.serve(app.fetch);
