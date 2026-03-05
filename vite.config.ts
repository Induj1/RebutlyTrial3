import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api/twilio-token": {
        target: "https://uvjclnbkhpfryqpwjjmo.supabase.co",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/twilio-token/, "/functions/v1/twilio-video-token"),
        secure: true,
      },
      // Proxy Edge Functions in dev to avoid Supabase CORS (when you can't set Allowed Origins)
      "/api/supabase-functions": {
        target: "https://uvjclnbkhpfryqpwjjmo.supabase.co",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/supabase-functions/, ""),
        secure: true,
      },
      // Same-origin proxy for debate-ai (avoids CORS in dev and prod)
      "/api/debate-ai": {
        target: "https://uvjclnbkhpfryqpwjjmo.supabase.co",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/debate-ai/, "/functions/v1/debate-ai"),
        secure: true,
        configure: (proxy) => {
          const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
          if (key) {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("Authorization", `Bearer ${key}`);
            });
          }
        },
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
