import { io, Socket } from "socket.io-client";
import type { RoomEvent } from "./room-events";
import type { CommandAcknowledgement } from "./room-command-contract";

type RoomSocketEvent =
  | "connected"
  | "disconnected"
  | "session_upgraded"
  | "command_ack"
  | "clock_sync"
  | "error";

type Listener = (data?: any) => void;
type RoomEventListener = (event: RoomEvent) => void;

export class RoomSocketService {
  private socket: Socket | null = null;
  private listeners: Partial<Record<RoomSocketEvent, Set<Listener>>> = {};
  private readonly roomEventListeners = new Set<RoomEventListener>();
  private eventsBound = false;

  private pingInterval: NodeJS.Timeout | null = null;
  public commandQueue: any[] = [];
  public lastCommand: any = null;

  private latestSessionToken: string | null = null;
  private latestParticipantId: string | null = null;

  private readonly handleConnect = () => {
    this.emit("connected");
    this.syncClock();
  };

  private readonly handleDisconnect = () => {
    this.emit("disconnected");
    if (this.pingInterval) clearInterval(this.pingInterval);
  };

  private readonly handleRoomState = (payload: any) => {
    this.emitRoomEvent({
      type: "room_state",
      room: payload.room,
      serverTime: payload.serverTime,
    });
  };

  private readonly handlePlaybackUpdated = (payload: any) => {
    this.emitRoomEvent({
      type: "playback_updated",
      playback: payload.playback,
      serverTime: payload.serverTime,
    });
  };

  private readonly handleParticipantJoined = (participant: any) => {
    this.emitRoomEvent({ type: "participant_joined", participant });
  };

  private readonly handleParticipantReconnected = (participant: any) => {
    this.emitRoomEvent({ type: "participant_reconnected", participant });
  };

  private readonly handleParticipantDisconnected = ({ participantId }: any) => {
    this.emitRoomEvent({ type: "participant_disconnected", participantId });
  };

  private readonly handleParticipantLeft = ({
    participantId,
    ownerId,
  }: any) => {
    this.emitRoomEvent({
      type: "participant_left",
      participantId,
      ownerId: ownerId ?? null,
    });
  };

  private readonly handleParticipantHealth = ({
    participantId,
    health,
  }: any) => {
    this.emitRoomEvent({ type: "participant_health", participantId, health });
  };

  private readonly handleSessionUpgraded = ({ participantId }: any) => {
    this.emit("session_upgraded", { participantId });
  };

  private readonly handleCommandAcknowledgement = (
    acknowledgement: CommandAcknowledgement,
  ) => {
    this.emit("command_ack", acknowledgement);
  };

  private readonly handleError = (error: any) => {
    this.emit("error", error);
  };

  public on(event: RoomSocketEvent, callback: Listener) {
    const listeners = this.listeners[event] ?? new Set<Listener>();
    listeners.add(callback);
    this.listeners[event] = listeners;
  }

  public off(event: RoomSocketEvent, callback: Listener) {
    this.listeners[event]?.delete(callback);
  }

  public onRoomEvent(callback: RoomEventListener) {
    this.roomEventListeners.add(callback);
  }

  public offRoomEvent(callback: RoomEventListener) {
    this.roomEventListeners.delete(callback);
  }

  public emit(event: RoomSocketEvent, data?: any) {
    this.listeners[event]?.forEach((callback) => callback(data));
  }

  private emitRoomEvent(event: RoomEvent) {
    this.roomEventListeners.forEach((callback) => callback(event));
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
            participantId: this.latestParticipantId,
          });
        },
      });
    }
    return this.socket;
  }

  private bindEvents() {
    if (!this.socket || this.eventsBound) return;
    const socket = this.socket;
    socket.on("connect", this.handleConnect);
    socket.on("disconnect", this.handleDisconnect);
    socket.on("room_state", this.handleRoomState);
    socket.on("playback_updated", this.handlePlaybackUpdated);
    socket.on("participant_joined", this.handleParticipantJoined);
    socket.on("participant_reconnected", this.handleParticipantReconnected);
    socket.on("participant_disconnected", this.handleParticipantDisconnected);
    socket.on("participant_left", this.handleParticipantLeft);
    socket.on("participant_health", this.handleParticipantHealth);
    socket.on("session_upgraded", this.handleSessionUpgraded);
    socket.on("command_ack", this.handleCommandAcknowledgement);
    socket.on("error", this.handleError);
    this.eventsBound = true;
  }

  private unbindEvents() {
    if (!this.socket || !this.eventsBound) return;
    const socket = this.socket;
    socket.off("connect", this.handleConnect);
    socket.off("disconnect", this.handleDisconnect);
    socket.off("room_state", this.handleRoomState);
    socket.off("playback_updated", this.handlePlaybackUpdated);
    socket.off("participant_joined", this.handleParticipantJoined);
    socket.off("participant_reconnected", this.handleParticipantReconnected);
    socket.off("participant_disconnected", this.handleParticipantDisconnected);
    socket.off("participant_left", this.handleParticipantLeft);
    socket.off("participant_health", this.handleParticipantHealth);
    socket.off("session_upgraded", this.handleSessionUpgraded);
    socket.off("command_ack", this.handleCommandAcknowledgement);
    socket.off("error", this.handleError);
    this.eventsBound = false;
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
    this.bindEvents();
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
      this.unbindEvents();
      this.socket.disconnect();
    }
    if (this.pingInterval) clearTimeout(this.pingInterval);
    this.emit("disconnected");
  }

  public sendCommand(
    roomId: string,
    sequence: number,
    type: string,
    payload?: any,
    participantId?: string | null,
  ) {
    if (!this.socket || !this.socket.connected) return null;

    const suppliedNonce = payload?.nonce;
    const nonce =
      typeof suppliedNonce === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        suppliedNonce,
      )
        ? suppliedNonce
        : crypto.randomUUID();
    const commandPayload =
      payload && typeof payload === "object" && "nonce" in payload
        ? { ...payload, nonce }
        : payload;

    this.lastCommand = {
      type,
      payload: commandPayload,
      roomId,
      sequence,
      nonce,
    };

    this.socket.emit("command", {
      roomId,
      nonce,
      clientSequence: sequence,
      command: { type, payload: commandPayload },
    });
    return nonce;
  }

  public upgradeSession(roomId: string, sequence: number, token: string) {
    if (!this.socket || !this.socket.connected) return null;

    this.latestSessionToken = token;
    const nonce = crypto.randomUUID();
    this.socket.emit("command", {
      roomId,
      nonce,
      clientSequence: sequence,
      command: { type: "upgrade_session", payload: { token } },
    });
    return nonce;
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
