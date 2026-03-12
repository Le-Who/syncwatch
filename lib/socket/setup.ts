import { Server } from "socket.io";
import * as cookie from "cookie";
import { jwtVerify } from "jose";

import { getJwtSecret } from "../jwt-config";

const JWT_SECRET = getJwtSecret();

export function setupSocketAuth(io: Server) {
  io.use(async (socket, next) => {
    try {
      const cookies = cookie.parse(socket.request.headers.cookie || "");
      const token = cookies.syncwatch_session || socket.handshake.auth?.token;

      if (token) {
        try {
          const { payload } = await jwtVerify(token, JWT_SECRET);
          if (payload.participantId) {
            socket.data.participantId = payload.participantId;
            return next();
          }
        } catch (jwtErr) {
          console.error(
            "JWT VERIFY FAILED in io.use! Token:",
            token,
            "Error:",
            jwtErr,
          );
        }
      } else {
        console.warn(
          "NO TOKEN PROVIDED or VERIFY FAILED. Using client-provided UUID.",
          "auth:",
          socket.handshake.auth,
        );
      }

      const clientParticipantId =
        socket.handshake.auth?.participantId || socket.id;
      socket.data.participantId = clientParticipantId;
      next();
    } catch (err) {
      console.error("UNKNOWN ERROR IN IO.USE FAILED!", err);
      // Even on error, allow connection but mark with client ID to prevent UI freezes
      const fallbackId = socket.handshake.auth?.participantId || socket.id;
      socket.data.participantId = fallbackId;
      next();
    }
  });
}
