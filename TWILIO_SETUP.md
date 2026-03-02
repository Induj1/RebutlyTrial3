# Deployment & CORS Setup

## Supabase CORS (Edge Functions)

If you get CORS errors when calling Edge Functions from your frontend (e.g. on Vercel):

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/uvjclnbkhpfryqpwjjmo/settings/api)
2. Open **Settings → API**
3. Find the **CORS** or **Site URL / Allowed origins** section
4. Add your production domain: `https://rebutly-trial34.vercel.app`
5. Add `http://localhost:5173` for local dev
6. Save

---

# Twilio Video Setup

Twilio Programmable Video powers live debate sessions. The following secrets are configured in Supabase:

| Secret | Status |
|--------|--------|
| `TWILIO_API_KEY_SID` | ✅ Set (SK2f906ec...) |
| `TWILIO_API_KEY_SECRET` | ✅ Set |
| `TWILIO_VIDEO_TTL_SECONDS` | ✅ Set (3600) |
| `TWILIO_ACCOUNT_SID` | ⚠️ **Required** |

## Add your Account SID

The **Account SID** (starts with `AC`) is different from the API Key SID. Get it from:

1. Go to [Twilio Console](https://console.twilio.com)
2. On the dashboard, find **Account Info** (top right or main section)
3. Copy the **Account SID** (format: `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

Then run:

```powershell
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Deploy the function

After all secrets are set:

```powershell
supabase functions deploy twilio-video-token
```

## Verify

1. Start a human vs human debate (Play → Find Match)
2. When matched, both users join the live room
3. Confirm video/audio works between participants

## Secret typo note

If token requests fail with auth errors, the secret may have a character typo. The 21st character can be lowercase `l` or uppercase `I`. Try the other if one doesn’t work:

```powershell
supabase secrets set TWILIO_API_KEY_SECRET=OWxaehEXnsuVc9Ls6RQv2lpa6v2bcrl4
```
