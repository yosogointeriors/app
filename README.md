# YOSOGO Portal Suite — Deployment Guide

Stack: **GitHub Pages** (hosts the 4 static HTML portals) · **Supabase** (database +
realtime sync) · **Cloudflare Worker** (the only place secrets live — login,
customer OTP, and the Facebook Lead Ads webhook).

```
Browser (GitHub Pages) ──anon key, read/write operational data──▶ Supabase
       │
       └──login / OTP / FB webhook──▶ Cloudflare Worker ──service_role key──▶ Supabase
                                              ▲
                                    Meta (Facebook Lead Ads)
```

---

## 1. Supabase — create the database

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** → paste the contents of `schema.sql` → Run.
3. (Optional, for testing) paste `seed.sql` → Run. This creates demo logins:
   - Admin: `admin@yosogo.in` / `admin123`
   - Team: `divya@yosogo.in`, `arjun@yosogo.in`, `sneha@yosogo.in`, `manoj@yosogo.in` — all `team123`
   - Customer demo login: phone `9840011223`, OTP `1234` (only while `DEMO_MODE=true` on the Worker)
4. **Settings → API** → copy your **Project URL** and **`anon` `public`** key. You'll also need the **`service_role`** key in step 3 — copy it now but keep it secret (don't put it in `config.js` or GitHub).
5. **Settings → API → Realtime** should already be on. Realtime is what keeps all 4 portals live-synced.

## 2. `config.js` — fill in the public values

Edit `config.js`:
```js
window.YOSOGO_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",          // the anon/public key, safe to commit
  WORKER_URL: "https://yosogo-api.yoursubdomain.workers.dev"  // fill in after step 3
};
```
The anon key is meant to be public — your Row Level Security policies (already
in `schema.sql`) decide what it can actually touch. Never put the
`service_role` key here.

## 3. Cloudflare Worker — deploy the secret-holding API

```bash
cd worker
npm install -g wrangler      # if you don't have it already
wrangler login
```

Edit `wrangler.toml`:
- `SUPABASE_URL` → your project URL (same as above)
- `ALLOWED_ORIGIN` → your future GitHub Pages URL, e.g. `https://yourname.github.io`
  (or your repo's Pages URL — see step 4)
- `DEMO_MODE` → keep `"true"` while testing (it echoes the OTP back so you can
  log in without an SMS provider); set to `"false"` before real launch

Set the secrets (never go in a file):
```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# paste the service_role key from Supabase → Settings → API

wrangler secret put FB_VERIFY_TOKEN
# make up any random string — you'll enter this same string in Meta's webhook setup

wrangler secret put FB_PAGE_ACCESS_TOKEN
# a Page access token with leads_retrieval permission (see step 5)
```

Deploy:
```bash
wrangler deploy
```
Copy the printed `https://yosogo-api.<subdomain>.workers.dev` URL into
`config.js`'s `WORKER_URL`.

## 4. GitHub — push the repo and enable Pages

```bash
git init
git add .
git commit -m "YOSOGO portal suite"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/yosogo.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
Your portals will be live at `https://YOUR-USERNAME.github.io/yosogo/`.

Go back and double-check `ALLOWED_ORIGIN` in `worker/wrangler.toml` matches this
exact URL (no trailing slash), then `wrangler deploy` again if you changed it.

## 5. Facebook Lead Ads webhook (optional, connects real FB leads → CRM)

1. Create a Meta App at [developers.facebook.com](https://developers.facebook.com) →
   add the **Webhooks** product.
2. Subscribe to your Facebook **Page**, field: `leadgen`.
   - Callback URL: `https://yosogo-api.<subdomain>.workers.dev/api/fb-webhook`
   - Verify Token: the exact string you set as `FB_VERIFY_TOKEN`
3. Generate a Page Access Token with the `leads_retrieval` and `pages_manage_ads`
   permissions (via Graph API Explorer or a System User in Business Manager) —
   this is what you set as `FB_PAGE_ACCESS_TOKEN`.
4. Submit a test lead via Meta's Lead Ads Testing Tool — it should appear in
   the Admin portal's Leads Inbox within seconds, with `source = facebook_ad`.

## 6. Try it end-to-end

Open your GitHub Pages URL → `index.html` → click into any portal. Data now
lives in Supabase and is shared live across every browser/device, not just
one local machine.

---

## Security notes before a real launch

- **Demo passwords**: change `admin123` / `team123` immediately, or better,
  add a "change password" flow to `worker/src/index.js`.
- **Password hashing**: `handleLogin` in the Worker currently compares plain
  text. Before storing real credentials, hash them (e.g. with a library that
  runs in Workers, like `bcryptjs`) and compare hashes instead.
- **SMS OTP**: `DEMO_MODE=true` returns the OTP directly so you can test
  without an SMS account. For production, set `DEMO_MODE=false` and wire an
  SMS provider (MSG91, Twilio, etc.) into `handleOtpRequest` in the Worker.
- **Write access**: operational tables (leads, projects, payments, etc.)
  currently allow the anon key full read/write, gated only by knowing the
  portal URL — appropriate for an internal tool with a small team. As YOSOGO
  scales, consider migrating the Admin/CRM/Site portals to Supabase Auth
  (one login per person) and tightening the RLS policies in `schema.sql` to
  check `auth.uid()` / a role claim instead of `using (true)`.
- **Photo/file uploads**: `uploadDesign()` and `uploadPhoto()` currently ask
  for an image URL (demo placeholder). For real uploads, add a Supabase
  Storage bucket and swap those prompts for a file `<input>` that uploads to
  Storage and stores the returned public URL.
