import { jwtVerify, SignJWT, type JWTPayload } from "jose";

export const SESSION_COOKIE_NAME = "syncwatch_session";
const UPGRADE_AUDIENCE = "syncwatch-socket-upgrade";
const signingAlgorithm = "HS256";

export function allowsLegacySocketToken() {
  return process.env.ALLOW_LEGACY_SOCKET_TOKEN === "true";
}

function participantIdentity(payload: JWTPayload) {
  if (typeof payload.participantId !== "string" || !payload.participantId) {
    throw new Error("Invalid session identity");
  }
  return {
    participantId: payload.participantId,
    nickname:
      typeof payload.nickname === "string" ? payload.nickname : undefined,
  };
}

export function issueSessionToken(participantId: string, secret: Uint8Array) {
  return new SignJWT({ participantId })
    .setProtectedHeader({ alg: signingAlgorithm })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifySessionToken(token: string, secret: Uint8Array) {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: [signingAlgorithm],
  });
  if (payload.aud !== undefined) throw new Error("Invalid session audience");
  return participantIdentity(payload);
}

export function issueUpgradeToken(
  participantId: string,
  roomId: string,
  secret: Uint8Array,
  nickname?: string,
) {
  return new SignJWT({
    participantId,
    roomId,
    ...(nickname ? { nickname } : {}),
  })
    .setProtectedHeader({ alg: signingAlgorithm })
    .setAudience(UPGRADE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30s")
    .sign(secret);
}

export async function verifyUpgradeToken(
  token: string,
  roomId: string,
  secret: Uint8Array,
  allowLegacy: boolean,
) {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: [signingAlgorithm],
  });
  if (
    (payload.aud !== UPGRADE_AUDIENCE ||
      payload.roomId !== roomId ||
      typeof payload.exp !== "number") &&
    !(allowLegacy && payload.aud === undefined)
  ) {
    throw new Error("Invalid session upgrade audience");
  }
  return participantIdentity(payload);
}
