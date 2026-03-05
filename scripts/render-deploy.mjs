#!/usr/bin/env node
/**
 * Trigger a Render deploy. Uses RENDER_SERVICE_ID if set, else "rebutly-debate-ai-api".
 * Run: npm run render:deploy   or   RENDER_SERVICE_ID=srv-xxx npm run render:deploy
 */
import { spawnSync } from "child_process";

const serviceId = process.env.RENDER_SERVICE_ID || "rebutly-debate-ai-api";
const result = spawnSync("render", ["deploys", "create", serviceId, "--wait"], {
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
