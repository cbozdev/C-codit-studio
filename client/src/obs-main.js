import "./obs-style.css";
import { DecartViewer } from "./decart.js";

const POLL_INTERVAL_MS = 2000;

const outputVideo = document.getElementById("output-video");
const placeholder = document.getElementById("placeholder");

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
    await instance.start(subscribeToken);
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
    const res = await fetch("/api/stream-session");
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
