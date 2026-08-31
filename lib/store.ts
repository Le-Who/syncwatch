import { create } from "zustand";
import { persist } from "zustand/middleware";
import { roomSocketService } from "./socket";
import { toast } from "sonner";
import type { RoomEvent } from "./room-events";
import type { RoomState } from "./types";
import type { CommandAcknowledgement } from "./room-command-contract";

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

interface AppState {
  room: RoomState | null;
  serverClockOffset: number;
  isConnected: boolean;
  participantId: string | null;
  sessionToken: string | null;
  nickname: string;
  commandSequence: number;
  clockSyncReady: boolean;
  occRollbackTick: number;
  isResyncing: boolean;
  lastCommandAcknowledgement: CommandAcknowledgement | null;
  commandError: string | null;
  resyncSession: () => Promise<void>;
  setNickname: (name: string) => void;
  connect: (roomId: string, nickname: string) => Promise<void>;
  disconnect: () => void;
  sendCommand: (type: string, payload?: any) => void;
  triggerOccRollback: () => void;
  init: () => void;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled room event: ${JSON.stringify(value)}`);
}

function handleConnected() {
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
  useStore.setState({ isConnected: false });
}

function handleClockSync({ offset }: { offset: number }) {
  useStore.setState({ serverClockOffset: offset });
}

function handleSessionUpgraded({ participantId }: { participantId: string }) {
  useStore.setState({ participantId });
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
}

function handleRoomEvent(event: RoomEvent) {
  const state = useStore.getState();

  switch (event.type) {
    case "room_state": {
      let newOffset = state.serverClockOffset;
      if (!state.clockSyncReady) {
        newOffset = event.serverTime - Date.now();
      }
      useStore.setState({
        room: event.room,
        serverClockOffset: newOffset,
        commandSequence: event.room.sequence,
        clockSyncReady: true,
      });
      return;
    }
    case "playback_updated": {
      if (!state.room) return;
      const playback = event.playback;
      useStore.setState({
        room: {
          ...state.room,
          currentMediaId: playback.mediaItemId,
          sequence: playback.sequence,
          playback: {
            status: playback.status,
            basePosition: playback.basePosition,
            baseTimestamp: playback.baseTimestamp,
            rate: playback.rate,
            updatedBy: playback.updatedBy,
            ...(playback.lastActionNonce
              ? { lastActionNonce: playback.lastActionNonce }
              : {}),
          },
        },
      });
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
  participantId: null,
  sessionToken: null,
  nickname: "",
  commandSequence: 1,
  clockSyncReady: false,
  occRollbackTick: 0,
  isResyncing: false,
  lastCommandAcknowledgement: null,
  commandError: null,
  triggerOccRollback: () =>
    set((state) => ({ occRollbackTick: state.occRollbackTick + 1 })),
  resyncSession: async () => {
    const state = get();
    if (state.isResyncing) return;
    set({ isResyncing: true });
    setTimeout(() => {
      set({ isResyncing: false });
    }, 60000);

    if (state.room && typeof window !== "undefined") {
      try {
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: state.participantId }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.token) {
            set({ sessionToken: data.token });
            roomSocketService.upgradeSession(
              state.room.id,
              state.commandSequence + 1,
              data.token,
            );

            setTimeout(() => {
              while (roomSocketService.commandQueue.length > 0) {
                const cmd = roomSocketService.commandQueue.shift();
                if (cmd) {
                  roomSocketService.sendCommand(
                    cmd.roomId,
                    cmd.sequence,
                    cmd.type,
                    cmd.payload,
                    get().participantId,
                  );
                }
              }
            }, 600);
          }
        }
      } catch (e) {
        console.warn("Failed to resync session", e);
        roomSocketService.commandQueue = [];
      }
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

      // Expose to window for Playwright E2E introspection
      (window as any).useRoomStore = { getState: get, setState: set };
      (window as any).__roomSocketService = roomSocketService;

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
  connect: async (roomId: string, nickname: string) => {
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
      if (!res.ok) {
        toast.error("Handshake failed. Features may be restricted.");
      } else {
        const data = await res.json();
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
          pId as string,
          data.token || sToken,
        );
      }
    } catch (err) {
      console.warn("Could not establish secure session", err);
      // Fallback
      roomSocketService.connect(roomId, nickname, pId as string, sToken);
    }
  },
  disconnect: () => {
    roomSocketService.disconnect();
    set({ isConnected: false, room: null });
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
      payload,
      state.participantId,
    );
  },
}));
