import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";

/** Dev-only: handle POST /api/debate-ai first so SPA fallback doesn't 404 it. */
function debateAiProxyPlugin(supabaseUrl: string, supabaseKey: string) {
  const base = supabaseUrl.replace(/\/$/, "");
  const target = `${base}/functions/v1/debate-ai`;
  const handler = (req: any, res: any, next: () => void) => {
        if (req.url !== "/api/debate-ai" && !req.url?.startsWith("/api/debate-ai?")) {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...(supabaseKey && { Authorization: `Bearer ${supabaseKey}` }),
          };
          fetch(target, { method: "POST", headers, body })
            .then(async (r) => {
              res.statusCode = r.status;
              const skip = ["content-encoding", "transfer-encoding"];
              r.headers.forEach((v, k) => {
                if (!skip.includes(k.toLowerCase())) res.setHeader(k, v);
              });
              res.end(await r.text());
            })
            .catch((err) => {
              console.error("[debate-ai proxy]", err);
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: err.message || "Failed to reach debate-ai" }));
            });
        });
  };
  return {
    name: "debate-ai-proxy",
    enforce: "pre" as const,
    configureServer(server: {
      middlewares: {
        use: (fn: (req: any, res: any, next: () => void) => void) => void;
        stack?: Array< { route: string; handle: (req: any, res: any, next: () => void) => void }>;
      };
    }) {
      // Prepend so we run before proxy/SPA fallback (POST would otherwise 404)
      const stack = (server.middlewares as any).stack;
      if (Array.isArray(stack)) {
        stack.unshift({ route: "", handle: handler });
      } else {
        server.middlewares.use(handler);
      }
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
      // Proxy Edge Functions in dev to avoid Supabase CORS (when you can't set Allowed Origins)
      "/api/supabase-functions": {
        target: supabaseUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/supabase-functions/, ""),
        secure: true,
      },
    },
  },
  plugins: [
    react(),
    mode === "development" && debateAiProxyPlugin(supabaseUrl, supabaseKey || ""),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  };
});
