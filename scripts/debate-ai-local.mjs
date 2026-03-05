/**
 * Local debate-ai logic (no Supabase). Same behaviour as the Edge Function: OpenAI + fallbacks.
 * Requires OPENAI_API_KEY in .env for real AI; otherwise returns fallback text.
 */
import { loadEnv } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const env = loadEnv("development", root, "");
const OPENAI_API_KEY = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
const OPENAI_MODEL = env.OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

const DEBATE_SYSTEM_PROMPT = `You are an expert competitive debater with extensive knowledge in philosophy, politics, economics, technology, and social sciences. You argue logically, cite real research and studies when relevant, and adapt your arguments to directly counter your opponent's points.

Guidelines:
- Make specific, substantive arguments backed by evidence or logical reasoning
- Reference real studies, statistics, historical examples, or philosophical frameworks
- Directly address and rebut your opponent's specific claims
- Maintain a respectful but assertive debating tone
- Keep responses focused and impactful (2-4 paragraphs max)
- Use structured argumentation: claim, warrant, impact
- Acknowledge strong opponent points while providing counterarguments`;

const FEEDBACK_SYSTEM_PROMPT = `You are an expert debate coach and judge with experience in competitive debate formats (BP, AP, LD, PF, WSDC). Analyze debate performances with specific, actionable feedback based on argumentation quality, evidence use, rebuttal effectiveness, and delivery.

Your feedback must be:
- Specific: Reference exact arguments or phrases from the debate
- Research-backed: Mention debate theory concepts and proven techniques
- Actionable: Provide concrete steps for improvement
- Balanced: Acknowledge strengths before areas for growth
- Structured: Use clear categories with scores and explanations

Scoring rubric (0-100):
- Argumentation (logic, structure, depth of analysis)
- Evidence (use of facts, examples, expert sources)
- Rebuttal (direct engagement with opponent, refutation quality)
- Delivery (clarity, persuasiveness, word economy)
- Strategy (time management, prioritization, narrative)`;

function fallbackOpponentResponse(req) {
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

function fallbackFeedback(req) {
  const userCount = (req.userArguments ?? []).length;
  const oppCount = (req.aiArguments ?? []).length;
  const balance = Math.max(0, Math.min(100, 65 + Math.min(10, userCount) - Math.max(0, 6 - oppCount)));
  return {
    type: "feedback",
    overallScore: balance,
    verdict: balance >= 75 ? "win" : balance <= 60 ? "loss" : "close",
    summary: "You presented a coherent case. Improve evidence depth and comparative weighing to increase win consistency.",
    categories: [
      { name: "Argumentation", score: Math.max(50, Math.min(95, balance + 4)), feedback: "Your structure was clear and mostly easy to follow.", strengths: ["Clear claims", "Consistent framing"], improvements: ["Tighter warrants", "Explicit impact calculus"] },
      { name: "Evidence", score: Math.max(45, Math.min(95, balance - 3)), feedback: "You used examples, but some claims needed stronger sourcing.", strengths: ["Relevant examples"], improvements: ["Use quantified evidence", "Compare source quality"] },
      { name: "Rebuttal", score: Math.max(45, Math.min(95, balance)), feedback: "You engaged opposing claims, but some responses were broad.", strengths: ["Direct clash on major points"], improvements: ["Answer mechanisms, not just outcomes"] },
      { name: "Delivery", score: Math.max(50, Math.min(95, balance + 2)), feedback: "Delivery was understandable and mostly paced well.", strengths: ["Good pacing"], improvements: ["Sharper signposting"] },
      { name: "Strategy", score: Math.max(45, Math.min(95, balance - 1)), feedback: "Strategic choices were reasonable but could prioritize key voters better.", strengths: ["Stayed on motion"], improvements: ["Earlier weighing", "Prioritize decisive clashes"] },
    ],
    keyMoments: [
      { type: "effective_rebuttal", description: "You identified a weak assumption in the opposing case.", suggestion: "Extend that line with one concrete empirical example." },
      { type: "missed_opportunity", description: "Some impacts were asserted without comparative weighting.", suggestion: "Explicitly compare magnitude, probability, and timeframe." },
    ],
    researchSuggestions: [
      "Prepare 2-3 reusable impact-weighing templates.",
      "Collect one strong study or statistic per common motion area.",
      "Practice 30-second rebuttal drills focused on mechanism attacks.",
    ],
  };
}

async function callOpenAI(req) {
  if (!OPENAI_API_KEY) return null;
  const topic = req.topic ?? "";
  const userSide = req.userSide ?? "proposition";
  const phase = req.phase ?? "opening";
  const userArguments = req.userArguments ?? [];
  const aiArguments = req.aiArguments ?? [];
  const conversationHistory = req.conversationHistory ?? [];

  if (req.type === "generate_feedback") {
    const debateTranscript = conversationHistory
      .map((msg) => `[${msg.role === "user" ? "Debater" : "AI Opponent"}]: ${msg.content}`)
      .join("\n\n");
    const userPrompt = `Analyze this debate performance and provide structured feedback.

Motion: "${topic}"
User's side: ${userSide}

Debate transcript:
${debateTranscript || "(no transcript)"}

User's arguments:
${userArguments.map((a, i) => `${i + 1}. ${a}`).join("\n") || "None."}

AI opponent's arguments:
${aiArguments.map((a, i) => `${i + 1}. ${a}`).join("\n") || "None."}

Respond with a single JSON object (no other text) with these exact keys:
- type: "feedback"
- overallScore: number 0-100
- verdict: "win" | "loss" | "close"
- summary: string (2-3 sentences)
- categories: array of { name: "Argumentation"|"Evidence"|"Rebuttal"|"Delivery"|"Strategy", score: number, feedback: string, strengths: string[], improvements: string[] }
- keyMoments: array of { type: "strength"|"missed_opportunity"|"effective_rebuttal"|"weak_argument", description: string, suggestion: string }
- researchSuggestions: string[]`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: FEEDBACK_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.5,
        max_tokens: 1500,
      }),
    });
    if (!res.ok) {
      console.error("[debate-ai local] OpenAI error", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return null;
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.overallScore === "number") return { type: "feedback", ...parsed };
      return null;
    } catch {
      return null;
    }
  }

  const WORDS_PER_MINUTE = 160;
  const maxWords = req.speechDurationSeconds ? Math.floor((req.speechDurationSeconds / 60) * WORDS_PER_MINUTE) : 400;
  const aiSide = userSide === "proposition" ? "opposition" : "proposition";
  const systemPrompt = `${DEBATE_SYSTEM_PROMPT}

CRITICAL: Your response must be EXACTLY ${maxWords} words or fewer. Count your words carefully. This is a timed debate speech and you must finish within the allocated time.

You are arguing the ${aiSide} side of this debate.
Motion: "${topic}"

Your opponent (${userSide}) has made the following arguments so far:
${userArguments.length > 0 ? userArguments.map((a, i) => `${i + 1}. ${a}`).join("\n") : "No arguments yet."}

Your previous arguments:
${aiArguments.length > 0 ? aiArguments.map((a, i) => `${i + 1}. ${a}`).join("\n") : "None yet."}`;

  const phaseInstructions = {
    opening: `Deliver your opening statement. Present 2-3 strong arguments for your side (${aiSide}). Set up the framework for the debate and establish your key themes. Reply with a JSON object containing a single key "response" whose value is your full speech text (no other keys).`,
    rebuttal: `Deliver your rebuttal. Directly address and refute your opponent's specific arguments. Point out logical flaws, missing evidence, or unconsidered consequences. Then reinforce your own position. Reply with a JSON object containing a single key "response" whose value is your full speech text (no other keys).`,
    closing: `Deliver your closing statement. Summarize why your side has won the key clashes in this debate. Weigh the impacts and explain why your arguments are more compelling. Reply with a JSON object containing a single key "response" whose value is your full speech text (no other keys).`,
  };
  const userPrompt = phaseInstructions[phase] ?? phaseInstructions.opening;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 800,
    }),
  });
  if (!res.ok) {
    console.error("[debate-ai local] OpenAI error", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content);
    const response = typeof parsed?.response === "string" ? parsed.response : typeof parsed?.content === "string" ? parsed.content : null;
    if (response && response.trim()) return { response };
    return null;
  } catch {
    if (content.trim()) return { response: content.trim() };
    return null;
  }
}

export async function handleDebateAILocal(body) {
  try {
    if (body.type === "generate_feedback") {
      const aiResponse = await callOpenAI(body);
      if (aiResponse?.type === "feedback") return { data: aiResponse, error: null };
      return { data: fallbackFeedback(body), error: null };
    }
    const aiResponse = await callOpenAI(body);
    if (typeof aiResponse?.response === "string" && aiResponse.response.trim()) {
      return { data: { response: aiResponse.response }, error: null };
    }
    return { data: { response: fallbackOpponentResponse(body) }, error: null };
  } catch (err) {
    console.error("[debate-ai local]", err);
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
