import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import * as cookie from "cookie";
import { jwtVerify, SignJWT } from "jose";
import { checkRedisRateLimit } from "@/lib/redis-rate-limit";

import { getJwtSecret } from "@/lib/jwt-config";
import { getAppRouteClientIp } from "@/lib/ip";

const SESSION_COOKIE = "syncwatch_session";

function sessionResponse(participantId: string, token: string) {
  return NextResponse.json(
    { success: true, participantId, token },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const secret = getJwtSecret();
    const cookies = cookie.parse(request.headers.get("cookie") ?? "");
    const existingToken = cookies[SESSION_COOKIE];
    if (existingToken) {
      try {
        const { payload } = await jwtVerify(existingToken, secret);
        if (typeof payload.participantId === "string") {
          return sessionResponse(payload.participantId, existingToken);
        }
      } catch {
        // Invalid session material is replaced without logging its contents.
      }
    }

    const ip = getAppRouteClientIp(request.headers) || "unknown";
    if (!(await checkRedisRateLimit(`api:auth:${ip}`, 1000, 60_000))) {
      return NextResponse.json(
        {
          error: "Too many new sessions. Retry in 60 seconds.",
          retryAfterSeconds: 60,
        },
        {
          status: 429,
          headers: { "retry-after": "60", "cache-control": "no-store" },
        },
      );
    }

    const participantId = randomUUID();
    const token = await new SignJWT({ participantId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(secret);

    const response = sessionResponse(participantId, token);

    response.cookies.set({
      name: SESSION_COOKIE,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (error) {
    console.error("Auth session error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
