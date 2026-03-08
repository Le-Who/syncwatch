import { io, Socket } from "socket.io-client";
import { toast } from "sonner";

class RoomSocketService {
  private socket: Socket | null = null;
  public getState!: () => any;
  public setState!: (state: any) => void;
  public getRoomState!: () => any;

  private pingInterval: NodeJS.Timeout | null = null;
  private commandQueue: any[] = [];
  private lastCommand: any = null;
  private isResyncing = false;

  init(getState: () => any, setState: (state: any) => void) {
    this.getState = getState;
    this.setState = setState;
  }

  getSocket() {
    if (!this.socket) {
      this.socket = io({
        path: "/socket.io",
        autoConnect: false,
        withCredentials: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        transports: ["websocket"], // Force WebSocket to bypass Playwright HTTP interception quirks
      });

      this.bindEvents();
    }
    return this.socket;
  }

  private bindEvents() {
    if (!this.socket) return;
    const socket = this.socket;

    socket.on("connect", () => {
      this.setState({ isConnected: true });
      this.syncClock();

      // MASK TCP DISCONNECTS: Automatically upgrade session on background reconnects
      const state = this.getState();
      if (state.sessionToken) {
        this.upgradeSession(state.sessionToken);
      }
    });

    socket.on("disconnect", () => {
      this.setState({ isConnected: false });
      if (this.pingInterval) clearInterval(this.pingInterval);
    });

    socket.on("room_state", (payload: any) => {
      const { serverClockOffset } = this.getState();
      let newOffset = serverClockOffset;
      if (serverClockOffset === 0) {
        newOffset = payload.serverTime - Date.now();
      }
      this.setState({
        room: payload.room,
        serverClockOffset: newOffset,
        commandSequence: payload.room.sequence,
      });
    });

    socket.on("participant_joined", (participant: any) => {
      const state = this.getState();
      if (!state.room) return;
      this.setState({
        room: {
          ...state.room,
          participants: {
            ...state.room.participants,
            [participant.id]: participant,
          },
        },
      });
    });

    socket.on("participant_left", ({ participantId }) => {
      const state = this.getState();
      if (!state.room) return;

      const newParticipants = { ...state.room.participants };
      delete newParticipants[participantId];
      this.setState({
        room: {
          ...state.room,
          participants: newParticipants,
        },
      });
    });

    socket.on("session_upgraded", ({ participantId }) => {
      // Silently update local store with new permanent ID without spamming toasts
      this.setState({ participantId });
    });

    socket.on("error", async (error: any) => {
      const msg = error.message || "An error occurred";

      if (msg === "VERSION_CONFLICT") {
        toast("Sync Adjustment", {
          description:
            "Another user changed the state first. Rolling back to server time.",
          icon: "⏪",
        });
        const state = this.getState();
        if (state.triggerOccRollback) {
          state.triggerOccRollback();
        }
        return; // Don't show generic error
      }

      // Avoid spamming toasts for rate limits
      if (!msg.includes("Too many") && !msg.includes("Rate limit")) {
        toast.error(msg);
      }

      // If we got an unauthorized command because we are a guest, try to recreate the session
      if (msg.includes("Unauthorized") || msg.includes("Guest")) {
        if (this.lastCommand) {
          this.commandQueue.push(this.lastCommand);
          this.lastCommand = null;
        }
        this.resyncSession();
      }
    });
  }

  private async resyncSession() {
    if (this.isResyncing) return;
    this.isResyncing = true;
    setTimeout(() => {
      this.isResyncing = false;
    }, 60000); // Massive 60 sec debounce: If we fail to fetch token, don't spam API. Fixes 429 loops.

    const state = this.getState();
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
            this.upgradeSession(data.token);

            // Replay queued commands transparently
            setTimeout(() => {
              while (this.commandQueue.length > 0) {
                const cmd = this.commandQueue.shift();
                if (cmd) {
                  // Bypass the guest guard since we just upgraded
                  this.socket?.emit("command", {
                    roomId: state.room.id,
                    sequence: state.commandSequence + 1,
                    type: cmd.type,
                    payload: cmd.payload,
                  });
                }
              }
            }, 600); // Give socket connection upgrade a moment to apply
          }
        }
      } catch (e) {
        console.warn("Failed to resync session", e);
        this.commandQueue = []; // Flush on fatal error
      }
    }
  }

  public connect(roomId: string, nickname: string, pId: string) {
    const socket = this.getSocket();
    if (!socket.connected) {
      socket.connect();
    }
    socket.emit("join_room", { roomId, nickname, participantId: pId });
  }

  public disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }

  public sendCommand(type: string, payload?: any) {
    if (!this.socket || !this.socket.connected) return;
    const { room, commandSequence, participantId } = this.getState();
    if (!room) return;

    // CLIENT-SIDE GUEST GUARD: Attempt graceful resync instead of failing
    if (participantId && participantId.startsWith("guest_")) {
      this.commandQueue.push({ type, payload });
      this.resyncSession();
      return;
    }

    this.lastCommand = { type, payload };

    this.socket.emit("command", {
      roomId: room.id,
      sequence: commandSequence + 1,
      type,
      payload,
    });
  }

  public upgradeSession(token: string) {
    if (!this.socket || !this.socket.connected) return;
    const { room, commandSequence } = this.getState();
    if (!room) return;

    this.socket.emit("command", {
      roomId: room.id,
      sequence: commandSequence + 1,
      type: "upgrade_session",
      payload: { token },
    });
  }

  private syncClock() {
    if (!this.socket) return;
    const socket = this.socket;
    let pings = 0;
    let offsets: number[] = [];

    const doPing = () => {
      socket.emit(
        "ping_time",
        Date.now(),
        (serverTime: number, clientTime: number) => {
          const end = Date.now();
          const rtt = end - clientTime;
          const offset = serverTime - (end - rtt / 2);

          offsets.push(offset);
          if (offsets.length > 5) offsets.shift();

          const sorted = [...offsets].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          this.setState({ serverClockOffset: median });
        },
      );
    };

    doPing();
    this.pingInterval = setInterval(() => {
      pings++;
      if (pings > 5) {
        if (this.pingInterval) clearInterval(this.pingInterval);
      } else {
        doPing();
      }
    }, 1000);
  }
}

export const roomSocketService = new RoomSocketService();
