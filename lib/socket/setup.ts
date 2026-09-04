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

      if (!token || typeof token !== "string") {
        return next(new Error("Authentication requires a valid session."));
      }

      const { payload } = await jwtVerify(token, JWT_SECRET);
      if (
        typeof payload.participantId !== "string" ||
        payload.participantId.length === 0
      ) {
        return next(new Error("Authentication requires a valid session."));
      }
      socket.data.participantId = payload.participantId;
      return next();
    } catch {
      return next(new Error("Authentication requires a valid session."));
    }
  });
}
