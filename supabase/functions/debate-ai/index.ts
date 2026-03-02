import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DebateRequest = {
  type?: "opponent_response" | "generate_feedback";
  topic?: string;
  userSide?: "proposition" | "opposition";
  phase?: "opening" | "rebuttal" | "closing";
  userArguments?: string[];
  aiArguments?: string[];
  conversationHistory?: Array<{ role: string; content: string }>;
};

const app = new Hono();

app.options("*", () => new Response(null, { headers: corsHeaders }));

function fallbackOpponentResponse(req: DebateRequest): string {
  const side = req.userSide === "proposition" ? "opposition" : "proposition";
  const phase = req.phase ?? "opening";
  const latestUserPoint = (req.userArguments ?? []).slice(-1)[0] ?? "your previous point";

  if (phase === "opening") {
    return `As ${side}, I challenge the motion by focusing on practical harms, implementation risk, and long-term unintended consequences. Your claim about ${latestUserPoint} overlooks key trade-offs that make this policy less effective than it appears.`;
  }

  if (phase === "rebuttal") {
    return `Your argument about ${latestUserPoint} depends on assumptions that are not guaranteed in real settings. Even if the intent is good, the mechanism is weak, the evidence is mixed, and the burden of proof is still unmet.`;
  }

  return `In closing, my side has shown stronger comparative impacts, clearer causal links, and better real-world feasibility. Your case raised important values, but it did not outweigh the practical downsides we established.`;
}

function fallbackFeedback(req: DebateRequest) {
  const userCount = (req.userArguments ?? []).length;
  const oppCount = (req.aiArguments ?? []).length;
  const balance = Math.max(0, Math.min(100, 65 + Math.min(10, userCount) - Math.max(0, 6 - oppCount)));

  return {
    type: "feedback",
    overallScore: balance,
    verdict: balance >= 75 ? "win" : balance <= 60 ? "loss" : "close",
    summary: "You presented a coherent case. Improve evidence depth and comparative weighing to increase win consistency.",
    categories: [
      {
        name: "Argumentation",
        score: Math.max(50, Math.min(95, balance + 4)),
        feedback: "Your structure was clear and mostly easy to follow.",
        strengths: ["Clear claims", "Consistent framing"],
        improvements: ["Tighter warrants", "Explicit impact calculus"],
      },
      {
        name: "Evidence",
        score: Math.max(45, Math.min(95, balance - 3)),
        feedback: "You used examples, but some claims needed stronger sourcing.",
        strengths: ["Relevant examples"],
        improvements: ["Use quantified evidence", "Compare source quality"],
      },
      {
        name: "Rebuttal",
        score: Math.max(45, Math.min(95, balance)),
        feedback: "You engaged opposing claims, but some responses were broad.",
        strengths: ["Direct clash on major points"],
        improvements: ["Answer mechanisms, not just outcomes"],
      },
      {
        name: "Delivery",
        score: Math.max(50, Math.min(95, balance + 2)),
        feedback: "Delivery was understandable and mostly paced well.",
        strengths: ["Good pacing"],
        improvements: ["Sharper signposting"],
      },
      {
        name: "Strategy",
        score: Math.max(45, Math.min(95, balance - 1)),
        feedback: "Strategic choices were reasonable but could prioritize key voters better.",
        strengths: ["Stayed on motion"],
        improvements: ["Earlier weighing", "Prioritize decisive clashes"],
      },
    ],
    keyMoments: [
      {
        type: "effective_rebuttal",
        description: "You identified a weak assumption in the opposing case.",
        suggestion: "Extend that line with one concrete empirical example.",
      },
      {
        type: "missed_opportunity",
        description: "Some impacts were asserted without comparative weighting.",
        suggestion: "Explicitly compare magnitude, probability, and timeframe.",
      },
    ],
    researchSuggestions: [
      "Prepare 2-3 reusable impact-weighing templates.",
      "Collect one strong study or statistic per common motion area.",
      "Practice 30-second rebuttal drills focused on mechanism attacks.",
    ],
  };
}

async function callOpenAI(req: DebateRequest) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;

  const isFeedback = req.type === "generate_feedback";
  const systemPrompt = isFeedback
    ? "You are an expert debate judge. Return strict JSON for the required feedback schema."
    : "You are a competitive debate opponent. Return concise, substantive responses.";

  const userPrompt = isFeedback
    ? `Topic: ${req.topic}\nUser side: ${req.userSide}\nUser arguments: ${JSON.stringify(req.userArguments ?? [])}\nOpponent arguments: ${JSON.stringify(req.aiArguments ?? [])}\nReturn JSON with fields: type='feedback', overallScore(0-100), verdict('win'|'loss'|'close'), summary, categories[{name,score,feedback,strengths,improvements}], keyMoments[{type,description,suggestion}], researchSuggestions[]`
    : `Topic: ${req.topic}\nYou are speaking as ${req.userSide === "proposition" ? "opposition" : "proposition"}.\nPhase: ${req.phase}\nUser arguments: ${JSON.stringify(req.userArguments ?? [])}\nConversation: ${JSON.stringify(req.conversationHistory ?? [])}\nReturn JSON: {"response":"..."}`;

  const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[debate-ai] OpenAI error", res.status, errText);
    return null;
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") return null;

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

app.post("/", async (c) => {
  try {
    const req = (await c.req.json().catch(() => ({}))) as DebateRequest;

    if (req.type === "generate_feedback") {
      const aiResponse = await callOpenAI(req);
      if (aiResponse?.type === "feedback") {
        return c.json(aiResponse, 200, corsHeaders);
      }
      return c.json(fallbackFeedback(req), 200, corsHeaders);
    }

    const aiResponse = await callOpenAI(req);
    if (typeof aiResponse?.response === "string" && aiResponse.response.trim()) {
      return c.json({ response: aiResponse.response }, 200, corsHeaders);
    }

    return c.json({ response: fallbackOpponentResponse(req) }, 200, corsHeaders);
  } catch (error) {
    console.error("[debate-ai] Unexpected error", error);
    return c.json({ error: "Internal server error" }, 500, corsHeaders);
  }
});

Deno.serve(app.fetch);
