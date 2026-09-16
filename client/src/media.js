export function isWebRTCSupported() {
  return Boolean(
    navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      window.RTCPeerConnection
  );
}

export async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter((d) => d.kind === "videoinput"),
    mics: devices.filter((d) => d.kind === "audioinput"),
  };
}

/**
 * `video` may be `true`/`false`, or a constraints object (e.g.
 * `{ width, height, frameRate }`) to request a specific capture format —
 * used to match the local camera to what a Decart realtime model expects.
 */
export async function getLocalStream({ cameraId, micId, video = true, audio = true } = {}) {
  let videoConstraints = false;
  if (video) {
    videoConstraints =
      typeof video === "object"
        ? { ...video }
        : { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (cameraId) videoConstraints.deviceId = { exact: cameraId };
  }

  const audioConstraints = audio
    ? { deviceId: micId ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true }
    : false;

  return navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: audioConstraints });
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}
