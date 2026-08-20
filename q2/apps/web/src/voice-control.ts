import { VoiceChat, type VoiceStatus } from "@nq/shared/supabase/voice";

/**
 * Original name: N/A
 * Source: N/A (web-app voice chat control)
 * Category: New
 * Purpose: Microphone toggle for peer-to-peer voice during a Quake II match.
 *
 * The mesh itself lives in the shared Supabase layer, so Quake 1 and Quake 2
 * run the same implementation rather than two. Only the control differs: this
 * app has no Vue, so the button is plain DOM.
 *
 * Quake takes pointer lock while playing, which makes the button unclickable
 * mid-match -- the M key is the control that actually works in game, and the
 * button doubles as the status readout. It deliberately stays visible during
 * pointer lock for that reason, unlike the pak-upload control beside it.
 */
export function installVoiceControl(roomId: string, playerId: string): () => void {
  const voice = new VoiceChat(roomId, playerId);

  const host = document.createElement("div");
  host.className = "voice-control";
  const button = document.createElement("button");
  host.appendChild(button);
  document.body.appendChild(host);

  let status: VoiceStatus = "off";
  let muted = true;

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
  };

  voice.onStatus((next) => { status = next; render(); });

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

  button.addEventListener("click", () => { void activate(); });

  const onKey = (event: KeyboardEvent): void => {
    if (event.code !== "KeyM" || event.repeat) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    void activate();
  };
  window.addEventListener("keydown", onKey);

  render();

  return (): void => {
    window.removeEventListener("keydown", onKey);
    voice.stop();
    host.remove();
  };
}
