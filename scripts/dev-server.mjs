/**
 * Dev: one server on 8080. /api/debate-ai runs locally (no Supabase). Run: npm run dev
 */
import connect from "connect";
import { createServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { handleDebateAILocal } from "./debate-ai-local.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PORTS = process.env.PORT ? [Number(process.env.PORT)] : [8080, 5174, 3000];

function handleDebateAi(req, res) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
  };
  console.log("[debate-ai]", req.method, req.url);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method === "GET") {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", message: "Debate AI runs locally. Use POST for the API." }));
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
    console.log("[debate-ai] local handler", body.type || "opponent_response");
    const { data, error } = await handleDebateAILocal(body);
    if (error) {
      res.writeHead(500, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
      return;
    }
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  });
}

const httpServer = http.createServer();

const vite = await createServer({
  root,
  configFile: path.join(root, "vite.config.ts"),
  server: {
    middlewareMode: true,
    hmr: { server: httpServer },
  },
  appType: "spa",
});

const app = connect();
app.use((req, res, next) => {
  const pathname = req.url?.split("?")[0] || "";
  if (pathname === "/api/debate-ai") {
    handleDebateAi(req, res);
    return;
  }
  next();
});
app.use(vite.middlewares);

httpServer.on("request", app);

function tryListen(ports, index = 0) {
  const port = ports[index];
  if (port == null) {
    console.error("\n  All ports in use. Stop other dev servers or set PORT=1234 npm run dev\n");
    process.exit(1);
  }
  httpServer.listen(port, "::", () => {
    console.log("\n  App:        http://localhost:" + port);
    console.log("  Debate AI:  POST /api/debate-ai (runs locally, no Supabase)");
    console.log("  Check:      open http://localhost:" + port + "/api/debate-ai — you should see {\"status\":\"ok\"}\n");
  }).on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      tryListen(ports, index + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}
tryListen(PORTS);
