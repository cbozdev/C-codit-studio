import "./obs-style.css";
import { DecartViewer } from "./decart.js";
import { apiUrl } from "./api.js";

const POLL_INTERVAL_MS = 2000;

const outputVideo = document.getElementById("output-video");
const placeholder = document.getElementById("placeholder");

// Each Studio user's stream is tracked separately on the server (keyed by
// user id), since two people could be streaming at once — this OBS output
// only has no login of its own, so it needs that id from its own URL
// (copied from the Studio's "OBS setup" card) to know whose stream to watch.
const studioUserId = new URLSearchParams(window.location.search).get("u");

let viewer = null;
let currentSubscribeToken = null;

function setWaiting(message) {
  outputVideo.srcObject = null;
  placeholder.hidden = false;
  placeholder.textContent = message;
}

async function stopViewer() {
  if (viewer) {
    await viewer.stop();
    viewer = null;
  }
  currentSubscribeToken = null;
}

async function startViewer(subscribeToken) {
  currentSubscribeToken = subscribeToken;
  const instance = new DecartViewer();

  instance.addEventListener("stream", (e) => {
    if (currentSubscribeToken !== subscribeToken) return;
    outputVideo.srcObject = e.detail.stream;
    placeholder.hidden = true;
  });
  instance.addEventListener("error", (e) => {
    if (currentSubscribeToken !== subscribeToken) return;
    console.error("Decart viewer error", e.detail.error);
    setWaiting("Lost connection to the stream — waiting to reconnect…");
  });

  try {
    await instance.start(subscribeToken, studioUserId);
    if (currentSubscribeToken !== subscribeToken) {
      // A newer session showed up while this one was still connecting.
      instance.stop();
      return;
    }
    viewer = instance;
  } catch (err) {
    console.error(err);
    setWaiting("Could not connect to the stream.");
  }
}

async function poll() {
  try {
    if (!studioUserId) {
      setWaiting("This link is missing its stream ID — copy the OBS URL again from the Studio's Start Stream panel.");
      return;
    }
    const res = await fetch(apiUrl(`/api/stream-session?u=${encodeURIComponent(studioUserId)}`));
    const session = await res.json();

    if (session.active && session.subscribeToken) {
      if (session.subscribeToken !== currentSubscribeToken) {
        await stopViewer();
        setWaiting("Connecting to stream…");
        await startViewer(session.subscribeToken);
      }
    } else if (currentSubscribeToken) {
      await stopViewer();
      setWaiting("Waiting for a stream to start on C Studio…");
    }
  } catch (err) {
    console.warn("Could not check stream session", err);
  } finally {
    setTimeout(poll, POLL_INTERVAL_MS);
  }
}

poll();
