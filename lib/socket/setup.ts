import { Server } from "socket.io";
import * as cookie from "cookie";

import { getJwtSecret } from "../jwt-config";
import {
  allowsLegacySocketToken,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "../session-auth";

export function setupSocketAuth(io: Server) {
  const jwtSecret = getJwtSecret();
  const allowLegacy = allowsLegacySocketToken();
  io.use(async (socket, next) => {
    try {
      const cookies = cookie.parse(socket.request.headers.cookie || "");
      const token =
        cookies[SESSION_COOKIE_NAME] ??
        (allowLegacy ? socket.handshake.auth?.token : undefined);

      if (!token || typeof token !== "string") {
        return next(new Error("Authentication requires a valid session."));
      }

      const identity = await verifySessionToken(token, jwtSecret);
      socket.data.participantId = identity.participantId;
      return next();
    } catch {
      return next(new Error("Authentication requires a valid session."));
    }
  });
}
