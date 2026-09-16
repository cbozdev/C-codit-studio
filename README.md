# C Studio

A single-user studio for live AI video effects, powered by
[Decart's Lucy 2.5](https://platform.decart.ai) real-time model, built to
feed **any** streaming or call app through OBS — not to be a call app itself.

Point your camera at the Studio page, pick a look, click **Start stream**,
then add the (permanent) output URL to OBS as a Browser Source and turn on
OBS's Virtual Camera. Zoom, Meet, Teams, Discord, Twitch, whatever — they
just see a regular webcam.

## How it works

```
ai-video-call/
├── server/   Decart token minting + a tiny stream-session relay
└── client/
    ├── index.html   The Studio: camera + AI output preview, controls, OBS setup panel
    └── obs.html     The Output page: what you actually put in OBS — video only, no UI
```

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
  to OBS once.
- **Security**: the permanent `DECART_API_KEY` lives only on the server.
  Both pages get a short-lived, scoped client token via
  `POST /api/decart-token`.

No accounts, no billing, no credits — this is a local, single-user tool.

## Setup

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
