/**
 * Start debate-ai server on 8081, then run Vite. Use when the app is served by Vite (e.g. Lovable) on 8080.
 * Run: npm run dev:vite-with-api
 * Then open the URL Vite prints (e.g. http://localhost:8080). /api/debate-ai is proxied to 8081.
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const proxy = spawn("node", ["scripts/debate-ai-proxy.mjs"], {
  cwd: root,
  stdio: "pipe",
  detached: true,
  shell: true,
});
proxy.unref();
proxy.stderr?.on("data", (d) => process.stderr.write(d));
proxy.stdout?.on("data", (d) => process.stdout.write(d));

await new Promise((r) => setTimeout(r, 1500));

const vite = spawn("npx", ["vite"], { cwd: root, stdio: "inherit", shell: true });
vite.on("exit", (code) => process.exit(code ?? 0));
