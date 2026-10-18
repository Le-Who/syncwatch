export interface SocketContext {
  currentRoomId: string | null;
  currentParticipantId: string | null;
  isDisconnected?: () => boolean;
  isJoiningRoom?: () => boolean;
  sessionUpgradeInFlight?: boolean;
  disconnectParticipant?: (
    roomId: string,
    participantId: string,
  ) => Promise<void>;
}
