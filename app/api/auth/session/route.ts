import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { checkRedisRateLimit } from "@/lib/redis-rate-limit";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || "default_local_secret_dont_use_in_prod", // Provide a default for local dev
);

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";

  // Bypass rate limiting in testing environments or when requested from localhost
  if (
    process.env.NODE_ENV !== "test" &&
    process.env.NODE_ENV !== "development" &&
    ip !== "::1" &&
    ip !== "127.0.0.1"
  ) {
    if (!(await checkRedisRateLimit(`api:auth:${ip}`, 10, 60000))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
  }

  try {
    const { participantId } = await request.json();
    if (!participantId || typeof participantId !== "string") {
      return NextResponse.json(
        { error: "participantId required" },
        { status: 400 },
      );
    }

    const token = await new SignJWT({ participantId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(secret);

    const response = NextResponse.json({ success: true, participantId, token });

    response.cookies.set({
      name: "syncwatch_session",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 24 hours
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
