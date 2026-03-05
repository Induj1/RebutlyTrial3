/**
 * Standalone debate-ai server (runs locally, no Supabase). Use when the app runs on another server.
 * Run: npm run debate-ai-proxy
 * Optional: set VITE_DEBATE_AI_PROXY_URL=http://localhost:8081 in .env so the app calls this server.
 */
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { handleDebateAILocal } from "./debate-ai-local.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Render sets PORT; local dev uses DEBATE_AI_PROXY_PORT or 8081
const PORT = Number(process.env.PORT) || Number(process.env.DEBATE_AI_PROXY_PORT) || 8081;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Max-Age": "86400",
  };
}

const server = http.createServer((req, res) => {
  const pathname = req.url?.split("?")[0] || "";
  const cors = corsHeaders();

  if (pathname !== "/api/debate-ai") {
    res.writeHead(404, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Use POST /api/debate-ai" }));
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method === "GET") {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", message: "Debate AI runs locally. POST here for the API." }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }
    console.log("[debate-ai] local", body.type || "opponent_response");
    const { data, error } = await handleDebateAILocal(body);
    if (error) {
      res.writeHead(500, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
      return;
    }
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n  Debate AI (local): http://localhost:" + PORT + "/api/debate-ai");
  console.log("  No Supabase. Set OPENAI_API_KEY in .env for real AI, or use fallback.\n");
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("Port " + PORT + " in use. Set DEBATE_AI_PROXY_PORT=8082 and try again.");
  } else {
    console.error(err);
  }
  process.exit(1);
});
