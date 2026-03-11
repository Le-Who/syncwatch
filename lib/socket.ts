import { io, Socket } from "socket.io-client";

export type RoomSocketEvent =
  | "connected"
  | "disconnected"
  | "room_state"
  | "participant_joined"
  | "participant_left"
  | "session_upgraded"
  | "clock_sync"
  | "error";

type Listener = (data?: any) => void;

class RoomSocketService {
  private socket: Socket | null = null;
  private listeners: Record<string, Listener[]> = {};

  private pingInterval: NodeJS.Timeout | null = null;
  public commandQueue: any[] = [];
  public lastCommand: any = null;

  private latestSessionToken: string | null = null;
  private latestParticipantId: string | null = null;

  public on(event: RoomSocketEvent, callback: Listener) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  public off(event: RoomSocketEvent, callback: Listener) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(
      (cb) => cb !== callback,
    );
  }

  public emit(event: RoomSocketEvent, data?: any) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach((cb) => cb(data));
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
        auth: (cb) => {
          // Send token in handshake to bypass strict cookie limits in isolated testing environments
          cb({ 
            token: this.latestSessionToken,
            participantId: this.latestParticipantId
          });
        },
      });

      this.bindEvents();
    }
    return this.socket;
  }

  private bindEvents() {
    if (!this.socket) return;
    const socket = this.socket;

    socket.on("connect", () => {
      this.emit("connected");
      this.syncClock();
    });

    socket.on("disconnect", () => {
      this.emit("disconnected");
      if (this.pingInterval) clearInterval(this.pingInterval);
    });

    socket.on("room_state", (payload: any) => {
      this.emit("room_state", payload);
    });

    socket.on("participant_joined", (participant: any) => {
      this.emit("participant_joined", participant);
    });

    socket.on("participant_left", ({ participantId }) => {
      this.emit("participant_left", { participantId });
    });

    socket.on("session_upgraded", ({ participantId }) => {
      this.emit("session_upgraded", { participantId });
    });

    socket.on("error", async (error: any) => {
      this.emit("error", error);
    });
  }

  public connect(
    roomId: string,
    nickname: string,
    pId: string,
    sessionToken: string | null,
  ) {
    this.latestSessionToken = sessionToken;
    this.latestParticipantId = pId;
    const socket = this.getSocket();
    if (!socket.connected) {
      socket.connect();
    }
    this.joinRoom(roomId, nickname, pId);
  }

  public joinRoom(roomId: string, nickname: string, participantId: string) {
    if (!this.socket) return;
    this.socket.emit("join_room", { roomId, nickname, participantId });
  }

  public disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }

  public sendCommand(
    roomId: string,
    sequence: number,
    type: string,
    payload?: any,
    participantId?: string | null,
  ) {
    if (!this.socket || !this.socket.connected) return;

    this.lastCommand = { type, payload, roomId, sequence };

    this.socket.emit("command", {
      roomId,
      sequence,
      type,
      payload,
    });
  }

  public upgradeSession(roomId: string, sequence: number, token: string) {
    if (!this.socket || !this.socket.connected) return;

    this.latestSessionToken = token;
    this.socket.emit("command", {
      roomId,
      sequence,
      type: "upgrade_session",
      payload: { token },
    });
  }

  private syncClock() {
    if (!this.socket) return;
    const socket = this.socket;
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
          if (offsets.length > 10) offsets.shift();

          // Trimmed mean (discard min/max)
          const sorted = [...offsets].sort((a, b) => a - b);
          let sum = 0;
          let count = 0;
          const startIdx = sorted.length > 3 ? 1 : 0;
          const endIdx = sorted.length > 3 ? sorted.length - 1 : sorted.length;

          for (let i = startIdx; i < endIdx; i++) {
            sum += sorted[i];
            count++;
          }

          this.emit("clock_sync", { offset: sum / count });
        },
      );
    };

    let currentInterval = 1000;
    const scheduleNextPing = () => {
      if (!this.socket?.connected) return;
      doPing();
      currentInterval = Math.min(currentInterval * 1.5, 30000);
      this.pingInterval = setTimeout(scheduleNextPing, currentInterval) as any;
    };

    if (this.pingInterval) clearTimeout(this.pingInterval as any);
    scheduleNextPing();
  }
}

export const roomSocketService = new RoomSocketService();
