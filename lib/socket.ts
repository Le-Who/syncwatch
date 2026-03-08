import { io, Socket } from "socket.io-client";
import { toast } from "sonner";

class RoomSocketService {
  private socket: Socket | null = null;
  public getState!: () => any;
  public setState!: (state: any) => void;
  public getRoomState!: () => any;

  private pingInterval: NodeJS.Timeout | null = null;

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
      toast.success("Successfully joined the room as authenticated user");
      this.setState({ participantId }); // Update local store with new permanent ID
    });

    let isResyncing = false;

    socket.on("error", async (error: any) => {
      const msg = error.message || "An error occurred";

      // Avoid spamming toasts for rate limits
      if (!msg.includes("Too many") && !msg.includes("Rate limit")) {
        toast.error(msg);
      }

      // If we got an unauthorized command because we are a guest, try to recreate the session
      if (msg.includes("Unauthorized") || msg.includes("Guest")) {
        if (isResyncing) return;
        isResyncing = true;
        setTimeout(() => {
          isResyncing = false;
        }, 5000); // 5 sec debounce to prevent 429 loops

        const state = this.getState();
        if (state.room && typeof window !== "undefined") {
          // Re-trigger the handshake
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
              }
              toast.success("Session resynced securely.");
            }
          } catch (e) {
            console.warn("Failed to resync session", e);
          }
        }
      }
    });
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

    // CLIENT-SIDE GUEST GUARD: Prevent sending commands if we are a guest
    if (participantId && participantId.startsWith("guest_")) {
      toast.error("Please log in to interact with the room.");
      return;
    }

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
