import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { pathToFileURL } from "node:url";
import { componentTagger } from "lovable-tagger";

/** Dev-only: handle /api/debate-ai locally (no Supabase, no separate proxy). */
function debateAiLocalPlugin() {
  let handlerPromise: Promise<{ handleDebateAILocal: (body: unknown) => Promise<{ data: unknown; error: Error | null }> }> | null = null;
  function getHandler() {
    if (!handlerPromise) {
      const scriptPath = path.join(__dirname, "scripts", "debate-ai-local.mjs");
      handlerPromise = import(pathToFileURL(scriptPath).href) as Promise<{ handleDebateAILocal: (body: unknown) => Promise<{ data: unknown; error: Error | null }> }>;
    }
    return handlerPromise;
  }
  const handler = (req: any, res: any, next: () => void) => {
    const pathname = req.url?.split("?")[0] || "";
    if (pathname !== "/api/debate-ai") {
      next();
      return;
    }
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization",
    };
    if (process.env.NODE_ENV !== "production") {
      console.log("[debate-ai] local", req.method, pathname);
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
      res.end(JSON.stringify({ status: "ok", message: "Debate AI runs locally. Use POST for the API." }));
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body = raw ? JSON.parse(raw) : {};
        const { handleDebateAILocal } = await getHandler();
        const { data, error } = await handleDebateAILocal(body);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
        if (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
          return;
        }
        res.end(JSON.stringify(data));
      } catch (err) {
        console.error("[debate-ai]", err);
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }));
      }
    });
  };
  return {
    name: "debate-ai-local",
    configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void; stack?: unknown[] } }) {
      return () => {
        const stack = (server.middlewares as any).stack;
        if (Array.isArray(stack)) {
          stack.unshift({ route: "", handle: handler });
        } else {
          server.middlewares.use(handler);
        }
      };
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "https://uvjclnbkhpfryqpwjjmo.supabase.co";

  return {
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api/twilio-token": {
        target: supabaseUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/twilio-token/, "/functions/v1/twilio-video-token"),
        secure: true,
      },
      "/api/supabase-functions": {
        target: supabaseUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/supabase-functions/, ""),
        secure: true,
      },
      // Forward to local debate-ai server (run "npm run debate-ai-proxy" in another terminal if using dev:vite / Lovable)
      "/api/debate-ai": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    mode === "development" && debateAiLocalPlugin(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  };
});
