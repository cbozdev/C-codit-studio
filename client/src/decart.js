import { createDecartClient, models } from "@decartai/sdk";
import { apiUrl } from "./api.js";

const MODEL_ID = "lucy-2.5";

/** Lucy 2.5's expected capture format (width/height/fps) for getUserMedia constraints. */
export function getRealtimeModel() {
  return models.realtime(MODEL_ID);
}

/**
 * Runs the SDK's built-in network preflight: gathers ICE candidates against
 * public STUN servers to see whether this network allows direct UDP (vs.
 * falling back to a relay, which adds real latency) and measures round-trip
 * time. This is entirely local — no Decart backend call, no billed session,
 * no API key needed — so it's safe to expose for free before a user spends
 * credits on a stream that's going to lag regardless of what we build.
 */
export async function checkConnection() {
  const client = createDecartClient({ apiKey: "preflight" });
  return client.realtime.checkConnectivity();
}

/**
 * Wraps the Decart Lucy 2.5 realtime SDK: fetches a short-lived client token
 * from our own backend (the permanent DECART_API_KEY never reaches the
 * browser), then streams the local camera through Lucy 2.5 and exposes the
 * transformed video back out as a MediaStream.
 */
export class DecartEffects extends EventTarget {
  constructor() {
    super();
    this.model = models.realtime(MODEL_ID);
    this.session = null;
    this.sessionId = null;
    this.accessToken = null;
    this.maxSeconds = null;
  }

  get isActive() {
    return Boolean(this.session);
  }

  /**
   * `accessToken` is the signed-in user's Supabase session token. Starting a
   * session here reserves credits from their wallet server-side (based on
   * their current balance) before Decart is ever contacted — the browser
   * has no way to start a session it can't pay for.
   */
  async start(localStream, { prompt, enhance, image, accessToken }) {
    if (this.session) await this.stop();
    this.accessToken = accessToken;

    const tokenRes = await fetch(apiUrl("/api/stream/start"), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.json().catch(() => ({}));
      throw new Error(body.error || "Could not start a billed stream session.");
    }
    const token = await tokenRes.json();
    this.sessionId = token.sessionId;
    this.maxSeconds = token.maxSeconds;
    this.dispatchEvent(new CustomEvent("balance", { detail: { balance: token.balance } }));

    // Use `.apiKey` (a short-lived "ek_..." credential), not `.token` — the
    // latter is a JWT mirroring the same credential for offline/server-side
    // verification, per the SDK's own CreateTokenResponse type. (Decart's
    // docs website shows `token.token` in one client-side auth example,
    // which contradicts the shipped SDK's type definitions — verified by
    // inspecting node_modules/@decartai/sdk/dist/tokens/client.d.ts and by
    // hitting the real token endpoint directly.)
    const client = createDecartClient({ apiKey: token.apiKey });

    this.session = await client.realtime.connect(localStream, {
      model: this.model,
      mirror: "auto",
      onRemoteStream: (stream) => {
        this.dispatchEvent(new CustomEvent("stream", { detail: { stream } }));
      },
      // Setting the prompt at connect time (instead of only via a follow-up
      // set() call) means the very first output frame is already
      // transformed, rather than briefly showing the raw camera feed.
      initialState: {
        prompt: { text: prompt, enhance: Boolean(enhance) },
      },
      // Self-anchoring (on by default) feeds the model's own prior output
      // back in as an additional reference, to keep continuity-style edits
      // (e.g. "change the wall color") stable over a long session. For a
      // character/body swap against a fixed reference image, that's
      // actively harmful: any single bad frame becomes part of the anchor,
      // and errors compound over time into a drifting, unrelated face —
      // exactly what "keeps changing to different faces" looks like.
      // Decart's own docs call this out explicitly: don't use self-anchoring
      // when the target should stay locked to a supplied reference image.
      ...(image ? { queryParams: { self_anchor: "false" } } : {}),
    });

    this.session.on("error", (error) => {
      this.dispatchEvent(new CustomEvent("error", { detail: { error } }));
    });
    this.session.on("connectionChange", (state) => {
      this.dispatchEvent(new CustomEvent("connection-change", { detail: { state } }));
    });
    this.session.on("generationTick", ({ seconds }) => {
      this.dispatchEvent(new CustomEvent("usage", { detail: { seconds } }));
    });

    // Lets a separate "viewer" page (e.g. the one OBS loads as a Browser
    // Source, which can't access this page's camera or JS state) attach to
    // this same session's output via client.realtime.subscribe().
    if (this.session.subscribeToken) {
      this.dispatchEvent(
        new CustomEvent("subscribe-token", { detail: { subscribeToken: this.session.subscribeToken } })
      );
    }

    // initialState doesn't take a reference image, so it's applied with a
    // follow-up set() call. set() replaces the entire session state
    // atomically — fields left out are cleared — so prompt/enhance are
    // re-sent here too, otherwise they'd be wiped by this call.
    if (image) {
      await this.session.set({ prompt, enhance: Boolean(enhance), image });
    }

    return this.session;
  }

  // setPrompt()/setImage() are targeted partial updates — unlike set(), they
  // only touch their own field and leave the other one (image/prompt)
  // exactly as it was.
  async updatePrompt(prompt, enhance) {
    if (!this.session) throw new Error("AI effects session is not active.");
    await this.session.setPrompt(prompt, { enhance: Boolean(enhance) });
  }

  /** Pass a File/Blob/URL to swap in a reference image live, or null to clear it. */
  async updateImage(image) {
    if (!this.session) throw new Error("AI effects session is not active.");
    await this.session.setImage(image);
  }

  async stop() {
    if (this.session) {
      try {
        this.session.disconnect();
      } catch (err) {
        console.warn("Error stopping Decart session", err);
      }
    }
    this.session = null;

    // Tells the server to stop the billing clock and refund whatever part
    // of the up-front reservation wasn't actually used. The server computes
    // this from its own started_at timestamp, not from anything reported
    // here, so there's nothing to gain by skipping or delaying this call.
    if (this.sessionId && this.accessToken) {
      try {
        const res = await fetch(apiUrl("/api/stream/stop"), {
          method: "POST",
          headers: { Authorization: `Bearer ${this.accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({ sessionId: this.sessionId }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          this.dispatchEvent(new CustomEvent("billed", { detail: body }));
        }
      } catch (err) {
        console.warn("Error finalizing stream billing", err);
      }
    }
    this.sessionId = null;
    this.accessToken = null;
  }
}

/**
 * The "viewer" counterpart to DecartEffects: attaches to an already-running
 * producer session's output using its subscribeToken, without needing
 * camera access or driving the prompt/image itself. This is what the OBS
 * output page uses — it runs in a separate, isolated browser process (OBS's
 * own embedded browser) that has no access to the Studio page's camera or
 * JS state, so the two can only be connected through Decart's own session,
 * not through anything in this app.
 */
export class DecartViewer extends EventTarget {
  constructor() {
    super();
    this.subscriber = null;
  }

  get isActive() {
    return Boolean(this.subscriber);
  }

  async start(subscribeToken, userId) {
    if (this.subscriber) await this.stop();

    const tokenRes = await fetch(apiUrl("/api/decart-token"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.json().catch(() => ({}));
      throw new Error(body.error || "Could not get a Decart access token from the server.");
    }
    const token = await tokenRes.json();
    const client = createDecartClient({ apiKey: token.apiKey });

    this.subscriber = await client.realtime.subscribe({
      token: subscribeToken,
      onRemoteStream: (stream) => {
        this.dispatchEvent(new CustomEvent("stream", { detail: { stream } }));
      },
    });

    this.subscriber.on("error", (error) => {
      this.dispatchEvent(new CustomEvent("error", { detail: { error } }));
    });
    this.subscriber.on("connectionChange", (state) => {
      this.dispatchEvent(new CustomEvent("connection-change", { detail: { state } }));
    });
  }

  async stop() {
    if (this.subscriber) {
      try {
        this.subscriber.disconnect();
      } catch (err) {
        console.warn("Error stopping Decart subscriber", err);
      }
    }
    this.subscriber = null;
  }
}
