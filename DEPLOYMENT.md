# Deploy: Frontend (Vercel) + Backend (Render)

## 1. Backend – Render (Debate AI API)

### Option A: Render CLI (recommended)

1. **Install Render CLI** (one-time):
   - **macOS (Homebrew):** `brew install render`
   - **Windows:** download from [GitHub releases](https://github.com/render-oss/cli/releases) or `npm install -g @render/cli` (if available).
   - **Linux/macOS (script):** `curl -fsSL https://raw.githubusercontent.com/render-oss/cli/refs/heads/main/bin/install.sh | sh`

2. **Log in and connect repo** (one-time):
   ```bash
   render login
   ```
   Then in [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint** → connect your Git repo and select `render.yaml` to create the service once.

3. **Validate and deploy from this repo:**
   ```bash
   npm run render:validate    # validate render.yaml
   npm run render:deploy     # trigger deploy (uses service name "rebutly-debate-ai-api" or set RENDER_SERVICE_ID)
   ```
   To use a specific service ID (from `render services`):  
   - macOS/Linux: `RENDER_SERVICE_ID=srv-xxxxx npm run render:deploy`  
   - Windows PowerShell: `$env:RENDER_SERVICE_ID="srv-xxxxx"; npm run render:deploy`

4. **Secrets:** In Render Dashboard → your service → **Environment** → add **OPENAI_API_KEY** (Secret) for real AI.

uihui### Option B: Manual deploy (dashboard)

1. Open **[dashboard.render.com](https://dashboard.render.com)** and log in.
2. Click **New +** → **Web Service**.
3. **Connect repository:** choose your Git provider (GitHub/GitLab/Bitbucket), select the **RebutlyTrial3** repo, click **Connect**.
4. **Configure:**
   - **Name:** `rebutly-debate-ai-api` (or any name).
   - **Region:** pick one (e.g. Oregon).
   - **Branch:** `main` (or your default).
   - **Runtime:** **Node**.
   - **Build Command:** `npm install`
   - **Start Command:** `npm run start:api`
   - **Instance type:** **Free**.
5. **Environment (optional):**  
   Click **Advanced** → **Add Environment Variable** → add **OPENAI_API_KEY** as **Secret** if you want real AI (otherwise the API uses fallback text).
6. Click **Create Web Service**. Wait for the first deploy to finish.
7. Copy your service URL (e.g. `https://rebutlytrial3.onrender.com`).  
   The API is at: **`https://<your-service-name>.onrender.com/api/debate-ai`**.  
   In **Vercel** → Project → Settings → Environment Variables, set **VITE_DEBATE_AI_API_URL** = `https://rebutlytrial3.onrender.com` (no trailing slash), then redeploy.

---

## 2. Frontend – Vercel (no CORS)

1. Go to [Vercel](https://vercel.com) → **Add New** → **Project** and import your repo.
2. **Framework preset:** Vite (usually auto-detected).
3. **Environment variables** (in Vercel project settings):
   - **DEBATE_AI_API_URL** = your Render API URL (no trailing slash), e.g.  
     `https://rebutly-debate-ai-api.onrender.com`  
     This is used by the **serverless proxy** (`api/debate-ai.js`); the browser never calls Render directly, so there is no CORS.
   - Do **not** set `VITE_DEBATE_AI_API_URL` — the app uses same-origin `/api/debate-ai` in production.
   - Add any other `VITE_*` / Supabase vars your app needs.
4. Deploy. The frontend calls `/api/debate-ai` on Vercel; the serverless function forwards to Render.

---

## Summary

| App        | Host   | URL / Env |
|-----------|--------|----------|
| Frontend  | Vercel | Set `VITE_DEBATE_AI_API_URL` to the Render API URL |
| Debate AI | Render | Start: `npm run start:api`. Set `OPENAI_API_KEY` for real AI |

After both are deployed, open the Vercel URL and use the Demo; it will use the API on Render.
