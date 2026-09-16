# C Studio

A paid, multi-user studio for live AI video effects, powered by
[Decart's Lucy 2.5](https://platform.decart.ai) real-time model, built to
feed **any** streaming or call app through OBS — not to be a call app itself.
Users sign up, buy credits, and pay per second of active streaming.

Point your camera at the Studio page, pick a look, click **Start stream**,
then add the (permanent) output URL to OBS as a Browser Source and turn on
OBS's Virtual Camera. Zoom, Meet, Teams, Discord, Twitch, whatever — they
just see a regular webcam.

## How it works

```
ai-video-call/
├── server/   Express API: Decart token minting, wallet/billing, admin, Korapay
└── client/
    ├── index.html   The Studio: sign in, camera + AI output preview, controls, wallet, OBS setup
    ├── obs.html     The Output page: what you actually put in OBS — video only, no UI
    └── admin.html   Admin panel: pricing, top-up packs, users, transactions
```

- **Accounts & database**: [Supabase](https://supabase.com) — Postgres +
  Auth. The browser talks to Supabase directly (with the public `anon` key)
  only for signing in and reading its own/public rows (profile, wallet
  balance, packs, pricing) — every table is locked down with Row Level
  Security (see `server/schema.sql`). The server uses the `service_role` key
  (bypasses RLS) for every write that touches money.
- **Billing model**: pay-per-second, pre-authorized. Starting a stream
  (`POST /api/stream/start`) computes the max seconds the user's current
  balance can afford, reserves that many credits atomically
  (`reserve_wallet_credits` — see `server/schema-functions.sql`, prevents a
  double-spend race from two rapid clicks), and caps the Decart session to
  exactly that duration via `maxSessionDuration` — Decart itself hard-stops
  it, independent of anything the client does. Stopping
  (`POST /api/stream/stop`) refunds whatever wasn't used, based on the
  server's own clock (`started_at` in the database), never on a duration the
  browser reports.
- **Payments**: [Korapay](https://korapay.com) hosted checkout. Topping up
  looks up the pack price server-side (never trusts a client-submitted
  amount), and a wallet is only ever credited by a **signature-verified**
  webhook (`POST /api/webhooks/korapay`, HMAC-SHA256 over the payload's
  `data` object) — never by anything the browser itself reports back.
- **Admin** (`admin.html`): gated on `profiles.role = 'admin'`, checked
  server-side on every admin route. Controls the credits-per-second rate and
  top-up packs, and shows all users/transactions.
- **Studio page** (`index.html`): captures your camera, connects to Lucy 2.5
  directly in the browser (`@decartai/sdk`), and shows your raw camera next
  to the live transformed output.
- **Output page** (`obs.html`): this is what goes in OBS. OBS's Browser
  Source runs in its own isolated browser process — it can't see your
  camera or the Studio page's JS state — so instead of duplicating the
  camera pipeline, it **subscribes** to the Studio's already-running Decart
  session via the SDK's producer/viewer split (`client.realtime.subscribe()`
  with the producer's `subscribeToken`). The server just relays which
  session is currently live (`GET/POST/DELETE /api/stream-session`), so the
  same OBS URL keeps working across every new stream you start — you add it
  to OBS once. Minting a token for this endpoint requires a currently-live
  session, so it can't be used to mint free Decart credentials against your
  account with nothing backing them.
- **Security**: the permanent `DECART_API_KEY` and Supabase `service_role`
  key live only on the server, never the browser.

## First-time setup after a fresh deploy

1. Run `server/schema.sql` then `server/schema-functions.sql` in Supabase's
   SQL Editor (in that order) — creates tables, RLS policies, starter packs,
   and the atomic wallet functions.
2. Sign up for an account through the Studio's normal sign-up form.
3. Promote that account to admin — run in Supabase SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
4. Add real Korapay keys (`KORAPAY_SECRET_KEY`, `KORAPAY_PUBLIC_KEY`,
   `KORAPAY_WEBHOOK_SECRET`) once you have them — top-ups return a 503 until
   then. In Korapay's dashboard, point the webhook URL at
   `https://<your-backend>/api/webhooks/korapay`.

## Live deployment

- **Frontend**: https://c-coditstudio.com — static files (`client/dist`)
  hosted on cPanel shared hosting (`public_html`), uploaded via SFTP.
- **Backend**: https://c-studio-api.onrender.com — the Express API deployed
  from [github.com/cbozdev/C-codit-studio](https://github.com/cbozdev/C-codit-studio)
  (root dir `server`) as a Render Web Service, free plan.

They're split across two hosts because this cPanel plan's server doesn't
have Node.js Selector installed (verified directly — the `Cpanel::API::NodeJS`
Perl module isn't present), so it can only serve static files, not run the
Express server. The two talk to each other cross-origin: the frontend is
built with `VITE_API_BASE_URL` pointing at the Render URL, and the backend's
`CLIENT_ORIGIN` allows both `https://c-coditstudio.com` and
`https://www.c-coditstudio.com` via CORS.

### Redeploying after a change

**Backend**: push to `main` on the GitHub repo above — Render auto-deploys
on every push (`autoDeploy: yes`).

```bash
git add -A && git commit -m "..." && git push
```

(Note: this Mac doesn't have Xcode Command Line Tools installed, so
`git`/local commits won't work until that's set up — `xcode-select --install`.
Until then, pushing changes means re-uploading files through GitHub's API or
web UI.)

**Frontend**: rebuild with the production API URL, then re-upload `dist/` to
cPanel via SFTP:

```bash
cd client
VITE_API_BASE_URL="https://c-studio-api.onrender.com" npm run build
# then upload dist/index.html, dist/obs.html, and dist/assets/ to public_html via SFTP
```

### A note on Render's free tier

Free web services on Render spin down after inactivity and take ~30–60s to
wake back up on the next request. The first "Start stream" click after a
period of no traffic may feel slow while the backend wakes up — subsequent
requests are fast. Upgrading to a paid Render plan removes this.

## Local setup

Requires Node.js 18+.

```bash
npm run install:all
```

Copy the server env file and add your Decart API key (get one at
https://platform.decart.ai — without it, the Studio page still runs, but
streaming stays disabled):

```bash
cp server/.env.example server/.env
# edit server/.env and set DECART_API_KEY=...
```

## Run

```bash
npm run dev
```

Opens the Studio at `http://localhost:5173` (API on `:3001`, proxied
through Vite in dev).

## Using it

1. Open `http://localhost:5173`, click **Enable camera**.
2. Pick a mode:
   - **Realistic** — a realism slider (0–10) controls how much subtle
     enhancement is applied while keeping you looking natural. (Lucy 2.5 has
     no native "realism" parameter — this maps the slider to a curated
     prompt template.)
   - **Stylized** — pick a preset (anime, retro VHS, cinematic, background
     swap, character swap, ...) or write a custom prompt.
3. Optionally drop in a reference photo for character/full-body swap or
   virtual try-on.
4. Click **Start stream**.
5. In OBS: **Sources → + → Browser Source**, paste the URL shown in the
   Studio's OBS setup panel (`http://localhost:5173/obs.html`), and set that
   source's Width/Height to **1280 × 720**.
6. **Controls → Start Virtual Camera** in OBS, then pick "OBS Virtual
   Camera" as your webcam in whatever app you're actually calling or
   streaming from.

The OBS URL never changes between sessions — start/stop streaming from the
Studio as often as you like, and the same Browser Source picks it back up
each time (it polls for the current session every 2 seconds).

## Notes for production use

- **Single-instance state**: which session is "live" is held in memory on
  the server (`server/src/streamSession.js`), not per-account — fine for one
  person on one machine, not for multiple concurrent users. A multi-user
  version would need real accounts and to key this by user/session id.
- **Token lifetime**: Decart client tokens are minted with `expiresIn: 3600`
  (the max) and a `maxSessionDuration` of 1800s as a cost safety cap, since
  Lucy 2.5 bills per second of active generation. Decart's SDK doesn't
  rotate the token mid-session on its own, so a token expiring while still
  connected will fail its next reconnect — raise `expiresIn` further if you
  routinely stream longer than that.
- **HTTPS**: browsers require a secure context for camera access outside of
  `localhost` — deploy both the client and server behind HTTPS.
