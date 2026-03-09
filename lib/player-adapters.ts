export function applyTwitchEventProxy(
  playerRef: any,
  realPlayerRef: any,
  handleNativePlay: () => void,
  handleNativePause: () => void,
) {
  try {
    // Note: react-player v3's getInternalPlayer() may not return the iframe wrapper,
    // instead the ref itself might point to the <twitch-video> web component.
    const twitchEl = realPlayerRef.current
      ? realPlayerRef.current.getInternalPlayer
        ? realPlayerRef.current.getInternalPlayer("twitch")
        : null
      : playerRef.current;

    if (twitchEl && !twitchEl.dataset.proxyAttached) {
      twitchEl.dataset.proxyAttached = "true";

      // Using Twitch standard DOM events
      twitchEl.addEventListener("play", () => {
        console.log("[TWITCH PROXY] play event fired");
        handleNativePlay();
      });
      twitchEl.addEventListener("playing", () => {
        console.log("[TWITCH PROXY] playing event fired");
        handleNativePlay();
      });
      twitchEl.addEventListener("pause", () => {
        console.log("[TWITCH PROXY] pause event fired");
        handleNativePause();
      });
    }
  } catch (e) {
    console.error("Failed to proxy twitch events", e);
  }
}
