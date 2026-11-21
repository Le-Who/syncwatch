import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import * as cookie from "cookie";
import { checkRedisRateLimit } from "@/lib/redis-rate-limit";

import { getJwtSecret } from "@/lib/jwt-config";
import { getAppRouteClientIp } from "@/lib/rate-limit";
import {
  allowsLegacySocketToken,
  issueSessionToken,
  issueUpgradeToken,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/session-auth";

async function sessionResponse(
  participantId: string,
  sessionToken: string,
  upgradeRoomId: string | null,
  secret: Uint8Array,
  nickname?: string,
) {
  const token = upgradeRoomId
    ? await issueUpgradeToken(participantId, upgradeRoomId, secret, nickname)
    : allowsLegacySocketToken()
      ? sessionToken
      : undefined;
  return NextResponse.json(
    { success: true, participantId, ...(token ? { token } : {}) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    const upgradeRoomId = new URL(request.url).searchParams.get("upgradeRoom");
    if (
      upgradeRoomId !== null &&
      (!upgradeRoomId || upgradeRoomId.length > 128)
    ) {
      return NextResponse.json(
        { error: "Invalid upgrade room." },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const secret = getJwtSecret();
    const cookies = cookie.parse(request.headers.get("cookie") ?? "");
    const existingToken = cookies[SESSION_COOKIE_NAME];
    const existing = existingToken
      ? await verifySessionToken(existingToken, secret).catch(() => null)
      : null;
    if (existing && existingToken) {
      return sessionResponse(
        existing.participantId,
        existingToken,
        upgradeRoomId,
        secret,
        existing.nickname,
      );
    }

    const ip = getAppRouteClientIp(request.headers);
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
    const token = await issueSessionToken(participantId, secret);

    const response = await sessionResponse(
      participantId,
      token,
      upgradeRoomId,
      secret,
    );

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
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
