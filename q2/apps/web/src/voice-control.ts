import { VoiceChat, type VoiceStatus } from "@nq/shared/supabase/voice";

/**
 * Original name: N/A
 * Source: N/A (web-app voice and video control)
 * Category: New
 * Purpose: Microphone and camera toggles for peer-to-peer play in Quake II.
 *
 * The mesh itself lives in the shared Supabase layer, so Quake 1 and Quake 2
 * run the same implementation rather than two. Only the control differs: this
 * app has no Vue, so the buttons are plain DOM.
 *
 * Quake takes pointer lock while playing, which makes both buttons unclickable
 * mid-match -- M and V are the controls that actually work in game, and the
 * buttons double as the status readout. They deliberately stay visible during
 * pointer lock for that reason, unlike the pak-upload control beside them.
 */
export function installVoiceControl(roomId: string, playerId: string): () => void {
  const voice = new VoiceChat(roomId, playerId);

  const host = document.createElement("div");
  host.className = "voice-control";
  const row = document.createElement("div");
  row.className = "voice-row";
  const button = document.createElement("button");
  const camButton = document.createElement("button");
  row.appendChild(button);
  row.appendChild(camButton);
  host.appendChild(row);

  // Never interactive: a click landing here during pointer lock was meant for
  // the game.
  const tiles = document.createElement("div");
  tiles.className = "voice-tiles";
  tiles.setAttribute("aria-hidden", "true");
  host.appendChild(tiles);
  document.body.appendChild(host);

  let status: VoiceStatus = "off";
  let muted = true;
  let cameraOn = false;
  let cameraBusy = false;
  let cameraNote = "";
  const videos = new Map<string, HTMLVideoElement>();

  const render = (): void => {
    const live = status === "live";
    const talking = live && !muted;
    button.textContent = ((): string => {
      switch (status) {
        case "starting": return "Mic...";
        case "live": return muted ? "Muted" : "Live";
        case "denied": return "Blocked";
        case "unavailable": return "No mic";
        default: return "Voice";
      }
    })();
    button.title = ((): string => {
      switch (status) {
        case "live": return muted
          ? "Microphone muted. Press M to talk."
          : "Microphone live. Press M to mute.";
        case "denied": return "The browser blocked microphone access for this site.";
        case "unavailable": return "No microphone available.";
        default: return "Turn on voice chat (press M)";
      }
    })();
    button.classList.toggle("talking", talking);
    button.classList.toggle("muted", !talking);

    camButton.textContent = cameraBusy ? "Cam..." : (cameraNote || (cameraOn ? "Cam on" : "Cam"));
    camButton.title = cameraNote
      ? cameraNote
      : cameraOn
        ? "Camera on. Press V to turn it off."
        : "Turn on your camera (press V). Quality follows the number of players.";
    camButton.classList.toggle("talking", cameraOn);
    camButton.classList.toggle("muted", !cameraOn);
  };

  const tileFor = (peerId: string): HTMLVideoElement => {
    let video = videos.get(peerId);
    if (!video) {
      video = document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      tiles.appendChild(video);
      videos.set(peerId, video);
    }
    return video;
  };

  const clearTiles = (): void => {
    videos.forEach((video) => { video.srcObject = null; video.remove(); });
    videos.clear();
  };

  // Registered after the helpers it calls: onStatus fires its listener
  // immediately, so a helper declared below would still be in its temporal
  // dead zone and the whole install would abort on a ReferenceError.
  voice.onStatus((next) => {
    status = next;
    if (next === "off") clearTiles();
    render();
  });

  voice.onStream((peerId, stream) => { tileFor(peerId).srcObject = stream; });
  voice.onLeave((peerId) => {
    const video = videos.get(peerId);
    if (!video) return;
    video.srcObject = null;
    video.remove();
    videos.delete(peerId);
  });

  // Both paths are user gestures, which getUserMedia and audio playback need.
  const activate = async (): Promise<void> => {
    if (voice.currentStatus === "live") {
      muted = voice.toggleMuted();
      render();
      return;
    }
    if (voice.currentStatus === "starting") return;
    const result = await voice.start();
    // Unmute straight away: asking for voice and then having to ask again to
    // be heard is a needless second step.
    if (result === "live") muted = voice.toggleMuted();
    render();
  };

  /**
   * Turning the camera on rebuilds the mesh, because foyer attaches tracks when
   * a connection is built rather than renegotiating a live one. That is a
   * second or two of reconnect, which is why this has a busy state and the
   * microphone does not.
   */
  const toggleCamera = async (): Promise<void> => {
    if (cameraBusy) return;
    cameraBusy = true;
    cameraNote = "";
    render();

    const wanted = !cameraOn;
    // The streams belong to the mesh that is about to be rebuilt.
    if (!wanted) clearTiles();

    const result = await voice.setCamera(wanted);
    cameraBusy = false;
    if (wanted && result !== "live") {
      cameraOn = false;
      cameraNote = result === "denied" ? "Blocked" : "No cam";
      render();
      return;
    }
    cameraOn = wanted && voice.cameraOn;
    if (result === "live") muted = voice.muted;
    render();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
    if (event.code === "KeyM") { event.preventDefault(); void activate(); return; }
    if (event.code === "KeyV") { event.preventDefault(); void toggleCamera(); }
  };

  button.addEventListener("click", () => { void activate(); });
  camButton.addEventListener("click", () => { void toggleCamera(); });
  window.addEventListener("keydown", onKey);

  render();

  return (): void => {
    window.removeEventListener("keydown", onKey);
    voice.stop();
    clearTiles();
    host.remove();
  };
}
