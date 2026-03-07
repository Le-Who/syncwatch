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

    socket.on("error", (error: any) => {
      toast.error(error.message || "An error occurred");
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
    const { room, commandSequence } = this.getState();
    if (!room) return;

    this.socket.emit("command", {
      roomId: room.id,
      sequence: commandSequence + 1,
      type,
      payload,
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
