import React, {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";

interface TwitchPlayerProps {
  url: string;
  playing: boolean;
  volume: number;
  muted: boolean;
  controls?: boolean;
  width?: string | number;
  height?: string | number;
  onReady?: (player: any) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (seconds: number) => void;
  onDurationChange?: (duration: number) => void;
  onPlaying?: () => void;
  onWaiting?: () => void;
  onError?: (e: any) => void;
  onEnded?: () => void;
}

export const TwitchPlayer = forwardRef((props: TwitchPlayerProps, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerInstanceRef = useRef<any>(null);
  const [isApiReady, setIsApiReady] = useState(
    !!(typeof window !== "undefined" && (window as any).Twitch?.Player),
  );

  // Expose ReactPlayer-like methods for usePlaybackSync compatibility
  useImperativeHandle(ref, () => ({
    getInternalPlayer: () => playerInstanceRef.current,
    getCurrentTime: () => playerInstanceRef.current?.getCurrentTime() || 0,
    getDuration: () => playerInstanceRef.current?.getDuration() || 0,
    seekTo: (position: number) => playerInstanceRef.current?.seek(position),
    play: () => playerInstanceRef.current?.play(),
    pause: () => playerInstanceRef.current?.pause(),
  }));

  useEffect(() => {
    if (isApiReady || typeof window === "undefined") return;
    const existingScript = document.getElementById("twitch-embed-script");
    if (!existingScript) {
      const script = document.createElement("script");
      script.id = "twitch-embed-script";
      script.src = "https://player.twitch.tv/js/embed/v1.js";
      script.async = true;
      script.onload = () => setIsApiReady(true);
      document.body.appendChild(script);
    } else {
      // If script exists but wasn't ready, poll or wait
      const checkTwitch = setInterval(() => {
        if ((window as any).Twitch?.Player) {
          clearInterval(checkTwitch);
          setIsApiReady(true);
        }
      }, 100);
      return () => clearInterval(checkTwitch);
    }
  }, [isApiReady]);

  useEffect(() => {
    const cleanupContainer = containerRef.current;
    if (!isApiReady || !cleanupContainer) return;

    let channel = "";
    let video = "";
    try {
      const urlObj = new URL(props.url);
      const parts = urlObj.pathname.split("/").filter(Boolean);
      if (parts[0] === "videos") {
        video = parts[1];
      } else {
        channel = parts[0];
      }
    } catch {
      channel = props.url
        .replace("https://www.twitch.tv/", "")
        .replace("https://twitch.tv/", "");
    }

    const options = {
      width: props.width || "100%",
      height: props.height || "100%",
      channel: channel || undefined,
      video: video || undefined,
      parent: [
        window.location.hostname || "localhost",
        "127.0.0.1",
        "syncwatch.example.com",
      ],
      muted: props.muted,
      autoplay: props.playing,
      controls: props.controls ?? true,
    };

    cleanupContainer.innerHTML = "";
    const newPlayerDiv = document.createElement("div");
    newPlayerDiv.style.width = "100%";
    newPlayerDiv.style.height = "100%";
    cleanupContainer.appendChild(newPlayerDiv);

    try {
      const player = new (window as any).Twitch.Player(newPlayerDiv, options);
      playerInstanceRef.current = player;

      const Twitch = (window as any).Twitch;

      player.addEventListener(Twitch.Player.READY, () => {
        player.setVolume(props.volume);
        player.setMuted(props.muted);
        props.onReady?.(player);
      });

      player.addEventListener(Twitch.Player.PLAY, () => props.onPlay?.());
      player.addEventListener(Twitch.Player.PAUSE, () => props.onPause?.());
      player.addEventListener(Twitch.Player.PLAYING, () => props.onPlaying?.());
      player.addEventListener(Twitch.Player.SEEK, (e: any) =>
        props.onSeek?.(e.position),
      );
      player.addEventListener(Twitch.Player.ENDED, () => props.onEnded?.());
      // Twitch doesn't have an explicit BUFFERING that perfectly aligns, but PLAYING catches the end of it.
    } catch (e) {
      console.error("Failed to initialize Twitch player", e);
      props.onError?.(e);
    }

    return () => {
      if (cleanupContainer) {
        cleanupContainer.innerHTML = "";
      }
      playerInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isApiReady, props.url]);

  useEffect(() => {
    if (!playerInstanceRef.current) return;
    try {
      if (props.playing) {
        playerInstanceRef.current.play();
      } else {
        playerInstanceRef.current.pause();
      }
    } catch (e) {}
  }, [props.playing]);

  useEffect(() => {
    if (!playerInstanceRef.current) return;
    try {
      playerInstanceRef.current.setVolume(props.volume);
      playerInstanceRef.current.setMuted(props.muted);
    } catch (e) {}
  }, [props.volume, props.muted]);

  return (
    <div
      ref={containerRef}
      style={{ width: props.width, height: props.height }}
    />
  );
});

TwitchPlayer.displayName = "TwitchPlayer";
