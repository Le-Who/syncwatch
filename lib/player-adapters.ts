import type React from "react";
import { PlayerMethods } from "./types";

type PlayerLike = PlayerMethods | null | undefined;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getInternalPlayer(player: PlayerLike, provider?: string): any {
  if (!player || typeof player.getInternalPlayer !== "function") return null;
  try {
    return player.getInternalPlayer(provider);
  } catch {
    return null;
  }
}

function getPlayerCandidates(player: PlayerLike, provider?: string): any[] {
  const internal = getInternalPlayer(player, provider);
  return internal && internal !== player ? [player, internal] : [player];
}

export function getPlayerCurrentTime(player: PlayerLike, provider?: string): number {
  for (const candidate of getPlayerCandidates(player, provider)) {
    if (!candidate) continue;
    if (typeof candidate.getCurrentTime === "function") {
      const value = candidate.getCurrentTime();
      if (isFiniteNumber(value)) return value;
    }
    if (isFiniteNumber(candidate.currentTime)) return candidate.currentTime;
  }
  return 0;
}

export function getPlayerDuration(player: PlayerLike, provider?: string): number {
  for (const candidate of getPlayerCandidates(player, provider)) {
    if (!candidate) continue;
    if (typeof candidate.getDuration === "function") {
      const value = candidate.getDuration();
      if (isFiniteNumber(value) && value >= 0) return value;
    }
    if (isFiniteNumber(candidate.duration) && candidate.duration >= 0) {
      return candidate.duration;
    }
  }
  return 0;
}

export function seekPlayerTo(
  player: PlayerLike,
  position: number,
  provider?: string,
): boolean {
  if (!isFiniteNumber(position) || position < 0) return false;

  for (const candidate of getPlayerCandidates(player, provider)) {
    if (!candidate) continue;
    if (typeof candidate.seekTo === "function") {
      candidate.seekTo(position, "seconds");
      return true;
    }
    if ("currentTime" in candidate) {
      candidate.currentTime = position;
      return true;
    }
  }
  return false;
}

export function setPlayerPlaybackRate(
  player: PlayerLike,
  rate: number,
  provider?: string,
): boolean {
  if (!isFiniteNumber(rate) || rate <= 0) return false;

  for (const candidate of getPlayerCandidates(player, provider)) {
    if (!candidate) continue;
    if (typeof candidate.setPlaybackRate === "function") {
      candidate.setPlaybackRate(rate);
      return true;
    }
    if ("playbackRate" in candidate) {
      candidate.playbackRate = rate;
      return true;
    }
  }
  return false;
}

export function applyTwitchEventProxy(
  playerRef: React.RefObject<PlayerMethods | null>,
  realPlayerRef: React.RefObject<PlayerMethods | null>,
  handleNativePlay: () => void,
  handleNativePause: () => void,
) {
  try {
    // Note: react-player v3's getInternalPlayer() may not return the iframe wrapper,
    // instead the ref itself might point to the <twitch-video> web component.
    const twitchEl =
      (realPlayerRef.current && realPlayerRef.current.getInternalPlayer
        ? realPlayerRef.current.getInternalPlayer("twitch")
        : null) || playerRef.current;

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
