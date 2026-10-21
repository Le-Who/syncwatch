import { create } from "zustand";
import { persist } from "zustand/middleware";
import { roomSocketService } from "./socket";
import { toast } from "sonner";
import type { CanonicalPlayback, RoomEvent } from "./room-events";
import type { PlaybackHealth, RoomState } from "./types";
import type { CommandAcknowledgement } from "./room-command-contract";
import { reduceCanonicalRoomEvent } from "./room-event-reducer";

const mediaIndexCache = new WeakMap<PlaylistItem[], Map<string, number>>();

export function getMediaIndexCached(playlist: PlaylistItem[], mediaId: string) {
  let map = mediaIndexCache.get(playlist);
  if (!map) {
    map = new Map();
    for (let i = 0; i < playlist.length; i++) {
      map.set(playlist[i].id, i);
    }
    mediaIndexCache.set(playlist, map);
  }
  return map.get(mediaId) ?? -1;
}

interface LocalSettingsState {
  volume: number;
  muted: boolean;
  theaterMode: boolean;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  toggleTheaterMode: () => void;
}

export const useSettingsStore = create<LocalSettingsState>()(
  persist(
    (set) => ({
      volume: 0.5,
      muted: true,
      theaterMode: false,
      setVolume: (volume) =>
        set({ volume: Math.min(1, Math.max(0, Number(volume) || 0)) }),
      setMuted: (muted) => set({ muted }),
      toggleTheaterMode: () =>
        set((state) => ({ theaterMode: !state.theaterMode })),
    }),
    { name: "syncwatch-settings" },
  ),
);

let roomStateRefreshInFlight = false;
let connectionAttempt = 0;

interface AppState {
  room: RoomState | null;
  serverClockOffset: number;
  isConnected: boolean;
  isSleeping: boolean;
  /** Monotonic transport generation, advanced once when a live socket drops. */
  connectionEpoch: number;
  /** Canonical delivery version observed synchronously at the socket drop. */
  connectionDeliveryFloor: number;
  participantId: string | null;
  sessionToken: string | null;
  nickname: string;
  commandSequence: number;
  canonicalDeliveryVersion: number;
  fullRoomSequence?: number;
  pendingPlayback?: CanonicalPlayback;
  clockSyncReady: boolean;
  occRollbackTick: number;
  isResyncing: boolean;
  lastCommandAcknowledgement: CommandAcknowledgement | null;
  commandError: string | null;
  resyncSession: () => Promise<void>;
  setNickname: (name: string) => void;
  setLocalPlaybackHealth: (health: PlaybackHealth) => void;
  /** True when dispatched, false for HTTP rejection, null when superseded. */
  connect: (roomId: string, nickname: string) => Promise<boolean | null>;
  disconnect: () => void;
  suspendConnection: () => void;
  sendCommand: (type: string, payload?: any) => void;
  triggerOccRollback: () => void;
  init: () => void;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled room event: ${JSON.stringify(value)}`);
}

function handleConnected() {
  if (useStore.getState().isConnected) return;
  useStore.setState({ isConnected: true });
  const state = useStore.getState();
  if (state.room && state.participantId) {
    roomSocketService.joinRoom(
      state.room.id,
      state.room.participants[state.participantId]?.nickname || "User",
      state.participantId,
    );
  }
  if (state.sessionToken && state.room) {
    roomSocketService.upgradeSession(
      state.room.id,
      state.commandSequence,
      state.sessionToken,
    );
  }
}

function handleDisconnected() {
  const state = useStore.getState();
  if (!state.isConnected) return;
  useStore.setState({
    isConnected: false,
    connectionEpoch: state.connectionEpoch + 1,
    connectionDeliveryFloor: state.canonicalDeliveryVersion,
  });
  roomStateRefreshInFlight = false;
}

function handleClockSync({ offset }: { offset: number }) {
  useStore.setState({ serverClockOffset: offset });
}

function handleSessionUpgraded({ participantId }: { participantId: string }) {
  useStore.setState({ participantId });
  if (typeof window !== "undefined") {
    localStorage.setItem("participantId", participantId);
  }
}

function handleCommandAcknowledgement(acknowledgement: CommandAcknowledgement) {
  const message =
    acknowledgement.status === "rejected"
      ? acknowledgement.message || "This action could not be applied."
      : null;
  useStore.setState({
    lastCommandAcknowledgement: acknowledgement,
    commandError: message,
  });
  if (message) toast.error(message);

  const state = useStore.getState();
  if (
    acknowledgement.status === "rejected" &&
    (acknowledgement.code === "NOT_JOINED" ||
      acknowledgement.code === "NOT_PARTICIPANT") &&
    state.isConnected &&
    state.room &&
    state.participantId &&
    roomSocketService.retainCommandForRecovery(
      state.room.id,
      acknowledgement.nonce,
    )
  ) {
    if (
      !state.isResyncing &&
      !roomSocketService.isSessionUpgradePending(state.room.id)
    ) {
      roomSocketService.joinRoom(
        state.room.id,
        state.room.participants[state.participantId]?.nickname ||
          state.nickname ||
          "User",
        state.participantId,
      );
      void state.resyncSession();
    }
    return;
  }
  if (
    acknowledgement.status === "rejected" &&
    (acknowledgement.code === "NOT_JOINED" ||
      acknowledgement.code === "NOT_PARTICIPANT")
  )
    return;
  if (
    acknowledgement.status === "rejected" &&
    acknowledgement.code !== "RATE_LIMITED" &&
    state.isConnected &&
    state.room &&
    state.participantId &&
    !roomStateRefreshInFlight
  ) {
    roomStateRefreshInFlight = true;
    roomSocketService.requestRoomState(state.room.id);
  }
}

function handleRoomEvent(event: RoomEvent) {
  const state = useStore.getState();

  switch (event.type) {
    case "room_state": {
      if (state.room?.id === event.room.id) {
        roomStateRefreshInFlight = false;
      }
      let newOffset = state.serverClockOffset;
      if (!state.clockSyncReady) {
        newOffset = event.serverTime - Date.now();
      }
      const reduced = reduceCanonicalRoomEvent(
        {
          room: state.room ?? event.room,
          deliveryVersion: state.canonicalDeliveryVersion,
          fullSequence: state.fullRoomSequence,
          pendingPlayback: state.pendingPlayback,
        },
        event,
      );
      useStore.setState({
        room: reduced.room,
        serverClockOffset: newOffset,
        commandSequence:
          state.room &&
          (state.room.generation ?? "legacy") !==
            (reduced.room.generation ?? "legacy")
            ? reduced.room.sequence
            : Math.max(state.commandSequence, reduced.room.sequence),
        clockSyncReady: true,
        canonicalDeliveryVersion: reduced.deliveryVersion,
        fullRoomSequence: reduced.fullSequence,
        pendingPlayback: reduced.pendingPlayback,
      });
      return;
    }
    case "playback_updated": {
      if (!state.room) return;
      const reduced = reduceCanonicalRoomEvent(
        {
          room: state.room,
          deliveryVersion: state.canonicalDeliveryVersion,
          fullSequence: state.fullRoomSequence,
          pendingPlayback: state.pendingPlayback,
        },
        event,
      );
      useStore.setState({
        room: reduced.room,
        canonicalDeliveryVersion: reduced.deliveryVersion,
        fullRoomSequence: reduced.fullSequence,
        pendingPlayback: reduced.pendingPlayback,
      });
      if (reduced.pendingPlayback && !roomStateRefreshInFlight) {
        roomStateRefreshInFlight = true;
        roomSocketService.requestRoomState(state.room.id);
      }
      return;
    }
    case "participant_joined":
    case "participant_reconnected": {
      if (!state.room) return;
      const participant = event.participant;
      if (
        event.type === "participant_joined" &&
        participant.id !== state.participantId
      ) {
        toast(`${participant.nickname || "Someone"} joined`, {
          icon: "👋",
          duration: 3000,
        });
      }
      useStore.setState({
        room: {
          ...state.room,
          participants: {
            ...state.room.participants,
            [participant.id]: participant,
          },
        },
      });
      return;
    }
    case "participant_disconnected": {
      const participant = state.room?.participants[event.participantId];
      if (!state.room || !participant) return;
      if (event.participantId === state.participantId) return;
      useStore.setState({
        room: {
          ...state.room,
          participants: {
            ...state.room.participants,
            [event.participantId]: {
              ...participant,
              connection: "reconnecting",
              disconnected: true,
            },
          },
        },
      });
      return;
    }
    case "participant_left": {
      if (!state.room) return;
      const leavingParticipant = state.room.participants[event.participantId];
      if (leavingParticipant && event.participantId !== state.participantId) {
        toast(`${leavingParticipant.nickname || "Someone"} left`, {
          icon: "🚪",
          duration: 3000,
        });
      }
      const participants = Object.fromEntries(
        Object.entries(state.room.participants)
          .filter(([id]) => id !== event.participantId)
          .map(([id, participant]) => [
            id,
            id === event.ownerId
              ? { ...participant, role: "owner" as const }
              : event.ownerId && participant.role === "owner"
                ? { ...participant, role: "viewer" as const }
                : participant,
          ]),
      );
      useStore.setState({
        room: {
          ...state.room,
          participants,
          leaderId:
            state.room.leaderId === event.participantId
              ? null
              : state.room.leaderId,
        },
      });
      return;
    }
    case "participant_health": {
      const participant = state.room?.participants[event.participantId];
      if (!state.room || !participant) return;
      useStore.setState({
        room: {
          ...state.room,
          participants: {
            ...state.room.participants,
            [event.participantId]: {
              ...participant,
              playbackHealth: event.health,
            },
          },
        },
      });
      return;
    }
    default:
      return assertNever(event);
  }
}

function handleSocketError(error: any) {
  const state = useStore.getState();
  const message = error.message || "An error occurred";
  if (state.commandError === message) return;
  if (message === "VERSION_CONFLICT") {
    state.triggerOccRollback();
    return;
  }

  if (
    !message.includes("Too many") &&
    !message.includes("Rate limit") &&
    !message.includes("Guest commands blocked")
  ) {
    toast.error(message);
  }

  if (message.includes("Unauthorized") || message.includes("Guest")) {
    if (
      roomSocketService.lastCommand &&
      !roomSocketService.commandQueue.includes(roomSocketService.lastCommand)
    ) {
      roomSocketService.commandQueue.push(roomSocketService.lastCommand);
      roomSocketService.lastCommand = null;
    }
    void state.resyncSession();
  }
}

export const useStore = create<AppState>((set, get) => ({
  room: null,
  serverClockOffset: 0,
  isConnected: false,
  isSleeping: false,
  connectionEpoch: 0,
  connectionDeliveryFloor: 0,
  participantId: null,
  sessionToken: null,
  nickname: "",
  commandSequence: 1,
  canonicalDeliveryVersion: 0,
  clockSyncReady: false,
  occRollbackTick: 0,
  isResyncing: false,
  lastCommandAcknowledgement: null,
  commandError: null,
  triggerOccRollback: () =>
    set((state) => ({ occRollbackTick: state.occRollbackTick + 1 })),
  resyncSession: async () => {
    const state = get();
    if (
      state.isResyncing ||
      !state.room ||
      !state.isConnected ||
      typeof window === "undefined" ||
      roomSocketService.isSessionUpgradePending(state.room.id)
    )
      return;
    set({ isResyncing: true });
    const attempt = connectionAttempt;
    const roomId = state.room.id;
    const generation = state.room.generation;
    const isCurrentSession = () =>
      connectionAttempt === attempt &&
      get().isConnected &&
      get().connectionEpoch === state.connectionEpoch &&
      get().room?.id === roomId &&
      get().room?.generation === generation;
    const controller = new AbortController();
    let rejectCancellation!: (error: Error) => void;
    const cancellation = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
    });
    const cancel = () => {
      clearTimeout(deadline);
      controller.abort();
      rejectCancellation(new Error("Session recovery cancelled"));
    };
    // Bound both response headers and JSON parsing, including transports that
    // finish after cancellation. Expiry permits manual retry without replay.
    const deadline = setTimeout(cancel, 15_000);
    const unsubscribe = useStore.subscribe(() => {
      if (!isCurrentSession()) cancel();
    });
    try {
      const data = await Promise.race([
        (async () => {
          const res = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ participantId: state.participantId }),
            signal: controller.signal,
          });
          return res.ok ? await res.json() : null;
        })(),
        cancellation,
      ]);
      if (!data || !isCurrentSession()) return;
      if (typeof data.participantId === "string") {
        set({ participantId: data.participantId });
        localStorage.setItem("participantId", data.participantId);
      }
      if (data.token) {
        set({ sessionToken: data.token });
        roomSocketService.upgradeSession(
          roomId,
          get().commandSequence + 1,
          data.token,
          get().participantId,
        );
      }
    } catch (e) {
      if (!controller.signal.aborted)
        console.warn("Failed to resync session", e);
    } finally {
      clearTimeout(deadline);
      unsubscribe();
      set({ isResyncing: false });
    }
  },
  init: () => {
    if (typeof window !== "undefined") {
      const storedName = localStorage.getItem("nickname") || "";
      const storedId =
        localStorage.getItem("participantId") || crypto.randomUUID();
      const storedToken = localStorage.getItem("sessionToken") || null;
      localStorage.setItem("participantId", storedId);
      set({
        nickname: storedName,
        participantId: storedId,
        sessionToken: storedToken,
      });

      if (process.env.NODE_ENV !== "production") {
        (window as any).useRoomStore = { getState: get, setState: set };
        (window as any).__roomSocketService = roomSocketService;
      }

      roomSocketService.on("connected", handleConnected);
      roomSocketService.on("disconnected", handleDisconnected);
      roomSocketService.on("clock_sync", handleClockSync);
      roomSocketService.on("session_upgraded", handleSessionUpgraded);
      roomSocketService.on("command_ack", handleCommandAcknowledgement);
      roomSocketService.on("error", handleSocketError);
      roomSocketService.onRoomEvent(handleRoomEvent);
    }
  },
  setNickname: (name: string) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("nickname", name);
    }
    set({ nickname: name });
    const { isConnected, room } = get();
    if (isConnected && room) {
      get().sendCommand("update_nickname", { nickname: name });
    }
  },
  setLocalPlaybackHealth: (health: PlaybackHealth) => {
    const state = get();
    if (!state.room || !state.participantId) return;
    const participant = state.room.participants[state.participantId];
    if (!participant || participant.playbackHealth === health) return;
    set({
      room: {
        ...state.room,
        participants: {
          ...state.room.participants,
          [state.participantId]: { ...participant, playbackHealth: health },
        },
      },
    });
  },
  connect: async (roomId: string, nickname: string) => {
    const attempt = ++connectionAttempt;
    set({ isSleeping: false });
    let pId = get().participantId;
    let sToken = get().sessionToken;
    if (!pId && typeof window !== "undefined") {
      pId = localStorage.getItem("participantId") || crypto.randomUUID();
      sToken = localStorage.getItem("sessionToken") || null;
      localStorage.setItem("participantId", pId);
      set({ participantId: pId, sessionToken: sToken });
    }

    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: pId }),
      });
      if (attempt !== connectionAttempt) return null;
      if (!res.ok) {
        toast.error("Handshake failed. Features may be restricted.");
        return false;
      } else {
        const data = await res.json();
        if (attempt !== connectionAttempt) return null;
        const serverParticipantId =
          typeof data.participantId === "string" ? data.participantId : pId;
        if (serverParticipantId) {
          pId = serverParticipantId;
          set({ participantId: serverParticipantId });
          if (typeof window !== "undefined") {
            localStorage.setItem("participantId", serverParticipantId);
          }
        }
        if (data.token) {
          set({ sessionToken: data.token });
          if (get().room?.id === roomId) {
            roomSocketService.upgradeSession(
              roomId,
              get().commandSequence,
              data.token,
            );
          }
        }
        roomSocketService.connect(
          roomId,
          nickname,
          serverParticipantId as string,
          data.token || sToken,
        );
        return true;
      }
    } catch (err) {
      if (attempt !== connectionAttempt) return null;
      console.warn("Could not establish secure session", err);
      // Fallback
      roomSocketService.connect(roomId, nickname, pId as string, sToken);
      return true;
    }
  },
  disconnect: () => {
    connectionAttempt += 1;
    roomSocketService.disconnect();
    set({
      isConnected: false,
      isSleeping: false,
      room: null,
      fullRoomSequence: undefined,
      pendingPlayback: undefined,
    });
  },
  suspendConnection: () => {
    connectionAttempt += 1;
    // Keep the canonical room and mounted player so activity can reconnect.
    // Set sleep first: the retry overlay must not reopen this transport.
    set({ isSleeping: true });
    roomSocketService.disconnect();
    set({ isConnected: false });
  },
  sendCommand: (type: string, payload?: any) => {
    const state = get();
    if (!state.room) return;

    set((s) => ({
      commandSequence: s.commandSequence + 1,
    }));

    // P4 Fix: Read the UPDATED sequence from the store after set()
    const newSequence = get().commandSequence;

    roomSocketService.sendCommand(
      state.room.id,
      newSequence,
      type,
      [
        "play",
        "pause",
        "seek",
        "update_rate",
        "sync_correction",
        "next",
        "video_ended",
      ].includes(type)
        ? {
            ...payload,
            mediaRun: state.room.mediaRun ?? 0,
            roomGeneration: state.room.generation ?? "legacy",
          }
        : payload,
      state.participantId,
    );
  },
}));
